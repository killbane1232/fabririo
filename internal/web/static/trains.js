import {pointOnRoute} from './geometry.js';

export const TRAIN_SPACING = 27;
const BOGIE_OFFSET = 7;
const STOP_MARGIN = 16;

// A locomotive and its wagons reverse together; no modulo wrap can split a
// consist between stations. The locomotive runs backwards on the return trip.
export function trainOnRoute(edge, time) {
  const count = Math.min(4, Math.floor((edge.length - STOP_MARGIN * 2) / TRAIN_SPACING) + 1);
  if (count < 2) return null;
  const low = STOP_MARGIN + (count - 1) * TRAIN_SPACING;
  const high = edge.length - STOP_MARGIN;
  const speed = 43, dwell = 1.8, travel = Math.max(0, high - low) / speed;
  const period = 2 * (travel + dwell);
  const phase = ((time + (edge.index || 0) * .37) % period + period) % period;
  let head = low, direction = 1, stopped = true;
  if (phase >= dwell && phase < dwell + travel) { head = low + (phase - dwell) * speed; stopped = false; }
  else if (phase >= dwell + travel && phase < 2 * dwell + travel) { head = high; direction = -1; }
  else if (phase >= 2 * dwell + travel) { head = high - (phase - 2 * dwell - travel) * speed; direction = -1; stopped = false; }
  const cars = Array.from({length: count}, (_, index) => {
    const distance = head - index * TRAIN_SPACING;
    const front = pointOnRoute(edge, distance + BOGIE_OFFSET, {wrap: false});
    const back = pointOnRoute(edge, distance - BOGIE_OFFSET, {wrap: false});
    return {index, locomotive: index === 0, distance, front, back,
      ...pointOnRoute(edge, distance, {wrap: false}), angle: Math.atan2(front.y - back.y, front.x - back.x)};
  });
  return {cars, head, direction, stopped, period};
}
