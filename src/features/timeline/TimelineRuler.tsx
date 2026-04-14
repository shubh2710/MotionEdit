import React, { useMemo } from 'react';
import { formatTime } from '../../utils/helpers';

interface TimelineRulerProps {
  width: number;
  zoom: number;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ width, zoom }) => {
  const markers = useMemo(() => {
    const result: { pos: number; time: number; major: boolean }[] = [];
    const pxPerSecond = zoom * 10;

    let interval: number;
    if (pxPerSecond >= 100) interval = 1;
    else if (pxPerSecond >= 40) interval = 2;
    else if (pxPerSecond >= 20) interval = 5;
    else if (pxPerSecond >= 8) interval = 10;
    else interval = 30;

    const majorEvery = interval <= 2 ? 5 : interval <= 5 ? 2 : 1;
    const totalSeconds = width / pxPerSecond;

    for (let t = 0; t <= totalSeconds; t += interval) {
      result.push({
        pos: t * pxPerSecond,
        time: t,
        major: t % (interval * majorEvery) === 0,
      });
    }
    return result;
  }, [width, zoom]);

  return (
    <div className="h-[30px] bg-gray-900 border-b border-gray-800 relative cursor-pointer">
      {markers.map(({ pos, time, major }) => (
        <div key={time} className="absolute top-0 h-full" style={{ left: pos }}>
          <div className={`w-px ${major ? 'h-full bg-gray-700' : 'h-2/5 bg-gray-800'} absolute bottom-0`} />
          {major && (
            <span className="absolute top-0.5 left-1 text-[10px] text-gray-500 whitespace-nowrap select-none">
              {formatTime(time)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
