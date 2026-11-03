import type { World } from './App';
import type { Config } from './near';
import { ICON, fmt, type Item } from './types';

const GROUNDS: { id: string; name: string; item: Item; blurb: string }[] = [
  { id: 'forest', name: 'The Forest', item: 'wood', blurb: 'Timber for the forge' },
  { id: 'mine', name: 'The Mine', item: 'ore', blurb: 'Ore for tools' },
  { id: 'fields', name: 'The Fields', item: 'wheat', blurb: 'Grain for the bakery' },
];

export function Grounds({ world, config, busy, onGather }: { world: World; config: Config; busy: string | null; onGather: (ground: string) => void }) {
  const capacity = world.params.ground_regen_per_day.map(r => r * world.params.ground_capacity_days);
  const best = (item: Item) => Math.max(0, ...world.shops.map(s => Number(s.bid[['wood', 'ore', 'wheat'].indexOf(item)] ?? 0)));
  const stamina = world.me?.stamina ?? 0;
  const tired = stamina < config.rules.swingCost;

  return (
    <div className="panel">
      <h2 className="section-title">Gathering grounds</h2>
      <p className="hint">Everyone shares the same grounds. They regrow through the day, so a crowded mine runs dry.</p>
      {GROUNDS.map((g, i) => {
        const left = world.town.grounds[i];
        const pct = Math.min(100, (left / capacity[i]) * 100);
        return (
          <div className="ground" key={g.id}>
            <div className="ground-head">
              <span className="ground-name">{ICON[g.item]} {g.name}</span>
              <span className="muted">best bid {fmt(best(g.item))}</span>
            </div>
            <div className="meter" title={`${left} of ${capacity[i]} ${g.item} left`}>
              <div className={`meter-fill ${pct < 20 ? 'low' : ''}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="ground-foot">
              <span className="muted">{left} {g.item} left · {g.blurb}</span>
              <button className="primary small" disabled={!!busy || tired || left < 1} onClick={() => onGather(g.id)}>
                {busy === 'Gather' ? 'Swinging…' : `Swing ×${config.rules.maxSwingsPerRequest}`}
              </button>
            </div>
          </div>
        );
      })}
      {tired && <p className="hint bad">Too tired to swing. Eat some bread or wait for the day to restore you.</p>}
    </div>
  );
}
