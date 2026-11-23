import { AppState } from 'react-native';
import { localDayStart, nextLocalDay } from './recentTimeline';

/** Timers can sleep with the app, so recheck the calendar on foreground as well. */
export function subscribeToLocalDayChanges(onChange: () => void, onSameDayResume?: () => void) {
  let day = localDayStart(Date.now());
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    clearTimeout(timer);
    const now = Date.now();
    const newDay = localDayStart(now);
    timer = setTimeout(schedule, nextLocalDay(now) - now + 1);
    if (newDay === day) return false;
    day = newDay;
    onChange();
    return true;
  };
  schedule();
  const app = AppState.addEventListener('change', state => {
    if (state === 'active' && !schedule()) onSameDayResume?.();
  });
  return () => { clearTimeout(timer); app.remove(); };
}
