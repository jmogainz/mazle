import { DISPLAY_NAME_MAX_LEN } from './displayNameRules';

export { DISPLAY_NAME_MAX_LEN };

// ~300 adjectives (max 6 chars each)
export const DISPLAY_NAME_ADJECTIVES = [
  // Personality/Mood
  'Zen', 'Smug', 'Chill', 'Grumpy', 'Calm', 'Mellow', 'Bold', 'Sly', 'Shy',
  'Snug', 'Moody', 'Peppy', 'Drowsy', 'Perky', 'Cranky', 'Gentle', 'Fierce',
  'Jolly', 'Merry', 'Proud', 'Humble', 'Eager', 'Wary', 'Weary', 'Bored',
  'Glad', 'Keen', 'Lost', 'Brave', 'Timid', 'Gruff', 'Witty', 'Shrewd',
  'Clever', 'Naive', 'Wise', 'Coy', 'Prim', 'Brash', 'Meek', 'Stern',
  // Action/Energy
  'Turbo', 'Swift', 'Nimble', 'Sneaky', 'Lazy', 'Hyper', 'Quick', 'Zippy',
  'Speedy', 'Bouncy', 'Jumpy', 'Wobbly', 'Drifty', 'Spinny', 'Slow', 'Fast',
  'Rapid', 'Steady', 'Still', 'Active', 'Idle', 'Antsy', 'Agile',
  // Mystical/Cool
  'Mystic', 'Cosmic', 'Shadow', 'Astral', 'Arcane', 'Lunar', 'Solar', 'Frosty',
  'Stormy', 'Misty', 'Ghosty', 'Spooky', 'Void', 'Eerie', 'Mythic', 'Primal',
  'Fabled', 'Dreamy', 'Hazy', 'Foggy', 'Murky', 'Dusky', 'Starry', 'Plasma',
  // Physical/Texture
  'Tiny', 'Fuzzy', 'Crispy', 'Soggy', 'Rusty', 'Dusty', 'Chunky', 'Fluffy',
  'Soft', 'Crisp', 'Gooey', 'Sticky', 'Shiny', 'Bumpy', 'Lumpy', 'Silky',
  'Glossy', 'Matte', 'Grainy', 'Smooth', 'Rough', 'Dense', 'Hollow', 'Solid',
  'Puffy', 'Flat', 'Round', 'Curvy', 'Wavy', 'Curly', 'Zigzag', 'Dotted',
  // Chaos/Fun
  'Chaos', 'Rogue', 'Wild', 'Spicy', 'Zesty', 'Wacky', 'Goofy', 'Dizzy',
  'Clumsy', 'Silly', 'Rowdy', 'Cheeky', 'Quirky', 'Funky', 'Janky', 'Oddly',
  'Kooky', 'Loopy', 'Nutty', 'Batty', 'Zany', 'Absurd', 'Random', 'Wonky',
  // Temperature/State
  'Toasty', 'Floppy', 'Melty', 'Frozen', 'Heated', 'Steamy', 'Hot', 'Cold',
  'Warm', 'Cool', 'Icy', 'Fiery', 'Burnt', 'Crisp', 'Raw', 'Fresh', 'Stale',
  // Colors
  'Red', 'Blue', 'Green', 'Gold', 'Amber', 'Coral', 'Ivory', 'Jade', 'Navy',
  'Olive', 'Pink', 'Teal', 'Aqua', 'Azure', 'Bronze', 'Copper', 'Gray', 'Ruby',
  'Tan', 'White', 'Black', 'Yellow', 'Orange', 'Purple', 'Violet', 'Indigo',
  'Maroon', 'Peach', 'Salmon', 'Beige', 'Khaki', 'Cream', 'Ebony', 'Silver',
  // Size/Scale
  'Big', 'Small', 'Giant', 'Mini', 'Micro', 'Mega', 'Ultra', 'Super', 'Thin',
  'Wide', 'Tall', 'Short', 'Long', 'Narrow', 'Broad', 'Vast', 'Petite',
  // Sound
  'Quiet', 'Loud', 'Silent', 'Noisy', 'Muted', 'Hushed', 'Shrill', 'Deep',
  // Taste
  'Sweet', 'Sour', 'Bitter', 'Salty', 'Tangy', 'Bland', 'Rich', 'Savory',
  // Weather
  'Rainy', 'Snowy', 'Windy', 'Cloudy', 'Sunny', 'Breezy', 'Humid', 'Arid',
  // Intensity
  'Mild', 'Harsh', 'Strong', 'Weak', 'Faint', 'Vivid', 'Dim', 'Bright',
  'Dull', 'Sharp', 'Blunt', 'Fierce', 'Light', 'Heavy', 'Thick', 'Sparse',
  // Time/Age
  'Old', 'New', 'Young', 'Modern', 'Retro', 'Prime', 'Late', 'Early',
  // Misc Fun
  'Lucky', 'Jinxed', 'Cursed', 'Magic', 'Buggy', 'Broken', 'Rustic', 'Urban',
  'Noble', 'Royal', 'Humble', 'Grand', 'Plain', 'Fancy', 'Basic', 'Elite',
  'Epic', 'Rare', 'Common', 'Secret', 'Hidden', 'Open', 'Closed', 'Locked',
  'Free', 'Stuck', 'Roving', 'Dapper', 'Messy', 'Shaggy', 'Sleek',
];

// ~350 nouns (max 6 chars each for safe 14-char total with 2-digit number)
export const DISPLAY_NAME_NOUNS = [
  // Kitchen Objects
  'Toast', 'Fork', 'Spoon', 'Waffle', 'Bagel', 'Mug', 'Pan', 'Pot', 'Ladle',
  'Whisk', 'Grater', 'Plate', 'Bowl', 'Kettle', 'Dish', 'Cup', 'Glass', 'Jar',
  'Tray', 'Rack', 'Sieve', 'Peeler', 'Tongs', 'Wok', 'Goblet',
  // Food - Meals/Snacks
  'Taco', 'Pizza', 'Pickle', 'Nugget', 'Donut', 'Muffin', 'Nacho', 'Noodle',
  'Wafer', 'Bean', 'Cheese', 'Turnip', 'Potato', 'Carrot', 'Onion', 'Pepper',
  'Lemon', 'Lime', 'Mango', 'Grape', 'Melon', 'Peach', 'Bread', 'Roll', 'Bun',
  'Cake', 'Pie', 'Tart', 'Scone', 'Cookie', 'Fudge', 'Candy', 'Syrup', 'Honey',
  'Jam', 'Butter', 'Cream', 'Soup', 'Stew', 'Broth', 'Gravy', 'Sauce', 'Pasta',
  'Rice', 'Oat', 'Corn', 'Barley', 'Lentil', 'Tofu', 'Bacon', 'Ham', 'Steak',
  'Burger', 'Egg', 'Omelet', 'Quiche', 'Salad', 'Wrap', 'Pita', 'Chip', 'Nut',
  'Almond', 'Walnut', 'Pecan', 'Cashew', 'Peanut', 'Seed', 'Berry', 'Apple',
  'Plum', 'Pear', 'Fig', 'Date', 'Olive', 'Tomato', 'Celery', 'Radish', 'Leek',
  // Everyday Objects
  'Sock', 'Lamp', 'Brick', 'Pencil', 'Couch', 'Pillow', 'Bucket', 'Button',
  'Cactus', 'Candle', 'Clock', 'Crayon', 'Drawer', 'Eraser', 'Folder', 'Glove',
  'Hammer', 'Ladder', 'Magnet', 'Napkin', 'Sponge', 'Staple', 'Teapot', 'Vase',
  'Broom', 'Mop', 'Rug', 'Shelf', 'Stool', 'Trunk', 'Key', 'Lock', 'Door',
  'Gate', 'Fence', 'Wall', 'Floor', 'Roof', 'Window', 'Stair', 'Step', 'Ramp',
  'Rail', 'Post', 'Pole', 'Beam', 'Plank', 'Board', 'Block', 'Cube', 'Sphere',
  'Cone', 'Prism', 'Disk', 'Ring', 'Loop', 'Chain', 'Link', 'Hook', 'Clip',
  'Pin', 'Nail', 'Screw', 'Bolt', 'Spring', 'Coil', 'Wire', 'Cable', 'Cord',
  'Rope', 'Thread', 'Yarn', 'Ribbon', 'Tape', 'Glue', 'Stone', 'Rock', 'Pebble',
  'Gravel', 'Sand', 'Dirt', 'Clay', 'Mud', 'Dust', 'Ash', 'Ember', 'Coal',
  // Tools
  'Axe', 'Saw', 'Drill', 'Chisel', 'File', 'Plane', 'Level', 'Ruler', 'Wrench',
  'Pliers', 'Clamp', 'Vise', 'Anvil', 'Forge', 'Kiln', 'Oven', 'Stove', 'Grill',
  'Fryer', 'Mixer', 'Juicer', 'Cooker', 'Crock', 'Can', 'Tin', 'Box', 'Crate',
  'Basket', 'Hamper', 'Bin', 'Barrel', 'Drum', 'Tank', 'Vat', 'Tub', 'Basin',
  'Sink', 'Pail', 'Scoop', 'Knife', 'Blade', 'Dagger', 'Sword', 'Saber', 'Foil',
  // Clothing
  'Hat', 'Cap', 'Bonnet', 'Beret', 'Fedora', 'Bowler', 'Beanie', 'Hood', 'Helmet',
  'Crown', 'Tiara', 'Band', 'Bow', 'Tie', 'Scarf', 'Shawl', 'Cape', 'Cloak',
  'Coat', 'Jacket', 'Blazer', 'Vest', 'Suit', 'Gown', 'Dress', 'Skirt', 'Kilt',
  'Shorts', 'Pants', 'Jeans', 'Slacks', 'Tights', 'Boot', 'Shoe', 'Sandal',
  'Loafer', 'Heel', 'Wedge', 'Clog', 'Mitten', 'Muff', 'Belt', 'Buckle', 'Zipper',
  'Snap', 'Lace', 'Knot', 'Braid', 'Weave', 'Knit', 'Stitch', 'Seam', 'Hem',
  'Cuff', 'Collar', 'Lapel', 'Pocket', 'Sleeve', 'Pleat', 'Frill', 'Trim',
  // Nature
  'Sun', 'Moon', 'Star', 'Planet', 'Comet', 'Meteor', 'Nebula', 'Galaxy', 'Cosmos',
  'Space', 'Sky', 'Cloud', 'Rain', 'Snow', 'Sleet', 'Hail', 'Fog', 'Mist', 'Dew',
  'Frost', 'Ice', 'Storm', 'Wind', 'Breeze', 'Gust', 'Gale', 'Wave', 'Tide',
  'Surf', 'Foam', 'Spray', 'Splash', 'Drip', 'Drop', 'Puddle', 'Pool', 'Pond',
  'Lake', 'River', 'Stream', 'Creek', 'Brook', 'Well', 'Geyser', 'Bay', 'Gulf',
  'Cove', 'Inlet', 'Harbor', 'Port', 'Dock', 'Pier', 'Wharf', 'Jetty', 'Beach',
  'Shore', 'Coast', 'Cliff', 'Bluff', 'Crag', 'Peak', 'Summit', 'Ridge', 'Valley',
  'Canyon', 'Gorge', 'Ravine', 'Chasm', 'Abyss', 'Pit', 'Hole', 'Cave', 'Cavern',
  'Grotto', 'Tunnel', 'Burrow', 'Den', 'Lair', 'Nest', 'Hive', 'Warren', 'Lodge',
  // Plants
  'Wood', 'Log', 'Twig', 'Branch', 'Bark', 'Leaf', 'Flower', 'Petal', 'Stem',
  'Root', 'Sprout', 'Bud', 'Bloom', 'Fruit', 'Veggie', 'Herb', 'Spice', 'Plant',
  'Tree', 'Bush', 'Shrub', 'Vine', 'Moss', 'Fern', 'Grass', 'Weed', 'Algae',
  'Fungus', 'Mold', 'Acorn', 'Reed', 'Bamboo', 'Palm', 'Oak', 'Birch', 'Willow',
  // Furniture
  'Bed', 'Cot', 'Crib', 'Bunk', 'Futon', 'Sofa', 'Chair', 'Bench', 'Pouf',
  'Swing', 'Table', 'Desk', 'Island', 'Bar', 'Cart', 'Stand', 'Closet', 'Chest',
  // Music
  'Cymbal', 'Gong', 'Bell', 'Chime', 'Maraca', 'Shaker', 'Rattle', 'Flute',
  'Oboe', 'Sax', 'Horn', 'Tuba', 'Bugle', 'Violin', 'Viola', 'Cello', 'Harp',
  'Lyre', 'Guitar', 'Banjo', 'Lute', 'Sitar', 'Piano', 'Organ', 'Synth',
  // Vehicles
  'Car', 'Truck', 'Van', 'Bus', 'Cab', 'Taxi', 'Wagon', 'Buggy', 'Bike', 'Cycle',
  'Trike', 'Quad', 'Moped', 'Vespa', 'Skate', 'Sled', 'Sleigh', 'Luge', 'Ski',
  'Kayak', 'Canoe', 'Raft', 'Boat', 'Ship', 'Yacht', 'Dinghy', 'Paddle', 'Oar',
  'Ferry', 'Cruise', 'Liner', 'Tanker', 'Cargo', 'Barge', 'Tug', 'Sub', 'Plane',
  'Jet', 'Prop', 'Glider', 'Copter', 'Drone', 'Rocket', 'Probe', 'Rover',
  // Animals - Mammals
  'Otter', 'Goose', 'Moose', 'Sloth', 'Panda', 'Walrus', 'Badger', 'Ferret',
  'Duck', 'Owl', 'Frog', 'Seal', 'Newt', 'Snail', 'Squid', 'Crab', 'Shrimp',
  'Llama', 'Alpaca', 'Lemur', 'Gecko', 'Koala', 'Wombat', 'Possum', 'Falcon',
  'Raven', 'Finch', 'Puffin', 'Parrot', 'Toucan', 'Bear', 'Wolf', 'Fox', 'Deer',
  'Elk', 'Boar', 'Hare', 'Mole', 'Bat', 'Vole', 'Stoat', 'Mink', 'Lynx', 'Puma',
  'Tiger', 'Lion', 'Zebra', 'Hippo', 'Rhino', 'Chimp', 'Ape', 'Monkey', 'Donkey',
  'Horse', 'Pony', 'Camel', 'Yak', 'Bison', 'Sheep', 'Goat', 'Pig', 'Cow', 'Bull',
  'Ox', 'Hen', 'Chick', 'Turkey', 'Pigeon', 'Dove', 'Crow', 'Jay', 'Robin', 'Swan',
  'Heron', 'Crane', 'Stork', 'Eagle', 'Hawk', 'Kite', 'Condor', 'Gull', 'Tern',
  // Animals - Sea/Reptile/Insect
  'Shark', 'Whale', 'Salmon', 'Trout', 'Bass', 'Pike', 'Carp', 'Eel', 'Ray',
  'Tuna', 'Cod', 'Clam', 'Mussel', 'Oyster', 'Prawn', 'Turtle', 'Lizard', 'Snake',
  'Viper', 'Cobra', 'Python', 'Boa', 'Iguana', 'Toad', 'Ant', 'Bee', 'Wasp',
  'Hornet', 'Beetle', 'Bug', 'Fly', 'Moth', 'Mantis', 'Spider', 'Worm', 'Slug',
  'Leech', 'Locust', 'Roach', 'Gnat', 'Midge', 'Aphid',
];

export function formatDisplayName(adjective: string, noun: string, num: number): string {
  return `${adjective}${noun}${num}`.slice(0, DISPLAY_NAME_MAX_LEN);
}

export function randomDisplayNameCandidate(randInt: (min: number, max: number) => number): string {
  const adjective = DISPLAY_NAME_ADJECTIVES[randInt(0, DISPLAY_NAME_ADJECTIVES.length - 1)] ?? 'Frosty';
  const noun = DISPLAY_NAME_NOUNS[randInt(0, DISPLAY_NAME_NOUNS.length - 1)] ?? 'Toast';
  const includeNumber = randInt(0, 1) === 1;
  const suffix = includeNumber ? String(randInt(10, 99)) : '';
  return `${adjective}${noun}${suffix}`.slice(0, DISPLAY_NAME_MAX_LEN);
}
