type Callback = (data?: any) => void;

class EventEmitter {
  private events: { [key: string]: Callback[] } = {};

  on(event: string, callback: Callback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
  }

  off(event: string, callback?: Callback) {
    if (!this.events[event]) return;
    if (!callback) {
        delete this.events[event];
    } else {
        this.events[event] = this.events[event].filter((cb) => cb !== callback);
    }
  }

  emit(event: string, data?: any) {
    if (!this.events[event]) return;
    this.events[event].forEach((cb) => cb(data));
  }
}

export const EventBus = new EventEmitter();
