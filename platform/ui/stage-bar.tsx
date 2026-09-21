import { Badge } from './primitives';

export function StageBar({ states, current }: { states: string[]; current: string }) {
  const idx = states.indexOf(current);
  return (
    <div className="flex items-center gap-1">
      {states.map((s, i) => {
        const tone = i < idx ? 'green' : i === idx ? 'amber' : 'slate';
        return (
          <div key={s} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300">→</span>}
            <Badge tone={tone}>{s}</Badge>
          </div>
        );
      })}
    </div>
  );
}
