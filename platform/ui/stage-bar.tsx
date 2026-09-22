import { Icon } from './icons';

export function StageBar({ states, current }: { states: string[]; current: string }) {
  const idx = states.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {states.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <span className={`h-px w-6 ${done || active ? 'bg-brand-400' : 'bg-ink-200'}`} />}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${
                active
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : done
                    ? 'bg-brand-50 text-brand-700 ring-brand-200'
                    : 'bg-white text-ink-400 ring-ink-200'
              }`}
            >
              <span
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] ${
                  active ? 'bg-white/20' : done ? 'bg-brand-500 text-white' : 'bg-ink-100'
                }`}
              >
                {done ? <Icon name="check" size={10} strokeWidth={3} /> : i + 1}
              </span>
              {s.replace(/_/g, ' ')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
