"""
Differentiable Verifier for Ice Puzzles - V2

Uses pure tensor operations for guaranteed gradient flow.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict


class DifferentiableIceVerifier(nn.Module):
    """
    Differentiable verifier using convolution-based propagation.
    
    Key insight: Use conv2d for shift operations - always differentiable.
    """
    
    FLOOR = 0
    WALL = 1
    ICE = 2
    LEDGE_U = 3
    LEDGE_D = 4  
    LEDGE_L = 5
    LEDGE_R = 6
    
    def __init__(self, grid_size: int = 13, num_iterations: int = 15):
        super().__init__()
        self.grid_size = grid_size
        self.num_iterations = num_iterations
        
        # Create shift kernels for 4 directions (differentiable shifts)
        # These move probability mass in each direction
        self.register_buffer('kernel_up', self._make_shift_kernel(-1, 0))
        self.register_buffer('kernel_down', self._make_shift_kernel(1, 0))
        self.register_buffer('kernel_left', self._make_shift_kernel(0, -1))
        self.register_buffer('kernel_right', self._make_shift_kernel(0, 1))
        
    def _make_shift_kernel(self, dr: int, dc: int) -> torch.Tensor:
        """Create 3x3 kernel that shifts by (dr, dc)."""
        kernel = torch.zeros(1, 1, 3, 3)
        # Place 1 at position that will shift input by (dr, dc)
        kernel[0, 0, 1 - dr, 1 - dc] = 1.0
        return kernel
    
    def forward(
        self,
        tile_logits: torch.Tensor,
        start_pos: torch.Tensor,
        goal_pos: torch.Tensor,
        temperature: float = 1.0,
    ) -> Dict[str, torch.Tensor]:
        """Compute differentiable verification metrics."""
        B, H, W, C = tile_logits.shape
        device = tile_logits.device
        
        # Move kernels to device
        for name in ['kernel_up', 'kernel_down', 'kernel_left', 'kernel_right']:
            if getattr(self, name).device != device:
                setattr(self, name, getattr(self, name).to(device))
        
        # Soft tile probabilities
        tile_probs = F.softmax(tile_logits / temperature, dim=-1)
        
        # Tile properties
        passable = 1.0 - tile_probs[..., self.WALL]  # [B, H, W]
        is_ice = tile_probs[..., self.ICE]
        is_stopping = 1.0 - is_ice  # Floor or ledge = stopping
        
        # Initialize reachability at start
        reach = torch.zeros(B, H, W, device=device)
        for b in range(B):
            sr, sc = int(start_pos[b, 0].item()), int(start_pos[b, 1].item())
            reach[b, sr, sc] = 1.0
        
        # Soft BFS with ice sliding
        # Each iteration = one "move"
        for it in range(self.num_iterations):
            reach = self._propagate_step(reach, passable, is_ice, is_stopping)
        
        # Extract goal metrics
        solvable = self._gather(reach, goal_pos)
        
        # Path count approximation via entropy
        # Lower entropy = fewer distinct paths = more unique
        reach_flat = reach.view(B, -1)
        reach_sum = reach_flat.sum(dim=-1, keepdim=True).clamp(min=1e-6)
        reach_dist = reach_flat / reach_sum
        entropy = -(reach_dist * (reach_dist + 1e-8).log()).sum(dim=-1)
        
        # Uniqueness: high when entropy is low relative to max
        max_entropy = torch.log(torch.tensor(H * W, device=device, dtype=torch.float))
        uniqueness = 1.0 - (entropy / max_entropy)
        
        return {
            'solvable': solvable,
            'uniqueness': uniqueness,
            'entropy': entropy,
            'reach_map': reach,
        }
    
    def _propagate_step(self, reach, passable, is_ice, is_stopping):
        """One step of propagation with ice sliding."""
        B, H, W = reach.shape
        
        # Add channel dim for conv: [B, 1, H, W]
        reach_4d = reach.unsqueeze(1)
        
        # Propagate in all 4 directions
        up = F.conv2d(reach_4d, self.kernel_up, padding=1)
        down = F.conv2d(reach_4d, self.kernel_down, padding=1)
        left = F.conv2d(reach_4d, self.kernel_left, padding=1)
        right = F.conv2d(reach_4d, self.kernel_right, padding=1)
        
        # Remove channel dim
        up = up.squeeze(1)
        down = down.squeeze(1)
        left = left.squeeze(1)
        right = right.squeeze(1)
        
        # Combine: max of current + all neighbors that could reach here
        neighbors = torch.stack([up, down, left, right], dim=0)
        max_neighbor = neighbors.max(dim=0)[0]
        
        # Apply ice sliding: if current is ice, propagate further
        # If stopping, keep the probability; if ice, propagate to next
        # Simplified: blend between stopping (keep) and ice (pass through)
        new_reach = reach * is_stopping + max_neighbor * is_ice
        
        # Also allow staying if already reachable
        new_reach = torch.max(reach, new_reach)
        
        # Mask by passable
        new_reach = new_reach * passable
        
        # Clamp to valid probability range
        new_reach = new_reach.clamp(0, 1)
        
        return new_reach
    
    def _gather(self, tensor, positions):
        """Extract values at positions."""
        B = tensor.shape[0]
        batch_idx = torch.arange(B, device=tensor.device)
        r = positions[:, 0].long()
        c = positions[:, 1].long()
        return tensor[batch_idx, r, c]


def compute_diff_loss(
    tile_logits: torch.Tensor,
    start_pos: torch.Tensor,
    goal_pos: torch.Tensor,
    target_moves: int = 10,
    temperature: float = 0.5,
) -> Dict[str, torch.Tensor]:
    """Compute differentiable loss for puzzle quality."""
    verifier = DifferentiableIceVerifier()
    metrics = verifier(tile_logits, start_pos, goal_pos, temperature)
    
    # Loss components
    solvable_loss = -torch.log(metrics['solvable'].clamp(min=1e-6)).mean()
    uniqueness_loss = 1.0 - metrics['uniqueness'].mean()
    
    total_loss = solvable_loss + 2.0 * uniqueness_loss
    
    return {
        'total_loss': total_loss,
        'solvable_loss': solvable_loss,
        'uniqueness_loss': uniqueness_loss,
        'metrics': metrics,
    }


if __name__ == "__main__":
    print("Testing differentiable verifier v2...")
    
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")
    
    # Create tile logits biased toward passable (so path exists)
    B, H, W, C = 4, 13, 13, 7
    tile_logits = torch.randn(B, H, W, C, device=device)
    # Bias toward floor (passable)
    tile_logits[..., 0] += 2.0  # Floor
    tile_logits[..., 1] -= 2.0  # Wall (make rare)
    tile_logits.requires_grad = True
    
    start_pos = torch.tensor([[1, 1], [1, 1], [1, 1], [1, 1]], device=device)
    goal_pos = torch.tensor([[11, 11], [11, 11], [11, 11], [11, 11]], device=device)
    
    print("Forward pass...")
    loss_dict = compute_diff_loss(tile_logits, start_pos, goal_pos)
    
    print(f"Total loss: {loss_dict['total_loss'].item():.4f}")
    print(f"Solvable: {loss_dict['metrics']['solvable'].mean().item():.4f}")
    print(f"Uniqueness: {loss_dict['metrics']['uniqueness'].mean().item():.4f}")
    
    print("\nBackward pass...")
    loss_dict['total_loss'].backward()
    
    grad_norm = tile_logits.grad.norm().item()
    print(f"Gradient norm: {grad_norm:.6f}")
    
    if grad_norm > 0:
        print("✓ Gradients flow!")
        
        # Show which tiles have biggest gradients
        grad_magnitude = tile_logits.grad.abs().sum(dim=-1)  # [B, H, W]
        max_idx = grad_magnitude[0].argmax()
        max_r, max_c = max_idx // W, max_idx % W
        print(f"Max gradient at: ({max_r.item()}, {max_c.item()})")
    else:
        print("✗ No gradients")
    
    # Test optimization
    print("\nOptimization test...")
    tile_logits = torch.randn(B, H, W, C, device=device)
    tile_logits[..., 0] += 1.0
    tile_logits[..., 1] -= 1.0
    tile_logits = tile_logits.clone().requires_grad_(True)
    
    optimizer = torch.optim.Adam([tile_logits], lr=0.1)
    
    for step in range(10):
        optimizer.zero_grad()
        loss_dict = compute_diff_loss(tile_logits, start_pos, goal_pos)
        loss_dict['total_loss'].backward()
        optimizer.step()
        
        if step % 2 == 0:
            print(f"  Step {step}: loss={loss_dict['total_loss'].item():.4f}, "
                  f"solvable={loss_dict['metrics']['solvable'].mean().item():.4f}, "
                  f"unique={loss_dict['metrics']['uniqueness'].mean().item():.4f}")
    
    print("\n✓ Complete!")
