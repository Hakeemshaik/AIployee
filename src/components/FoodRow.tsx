import { CATEGORY_EMOJI, type Food } from '../types'
import { fmtG, fmtKcal } from '../lib/nutrition'

/** "per 100 g" or "per burger" — the basis its nutrients are quoted for. */
export function basisLabel(food: Food): string {
  return food.measure === 'weight' ? 'per 100 g' : `per ${food.unitName ?? 'unit'}`
}

interface Props {
  food: Food
  onClick?: () => void
  favourite?: boolean
  onToggleFavourite?: () => void
  /** Overrides the default "per basis" summary line. */
  subtitle?: string
  right?: React.ReactNode
}

export function FoodRow({ food, onClick, favourite, onToggleFavourite, subtitle, right }: Props) {
  return (
    <div className="food-row" onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="food-emoji" aria-hidden="true">
        {CATEGORY_EMOJI[food.category]}
      </div>
      <div className="food-main">
        <div className="food-name">{food.name}</div>
        <div className="food-sub">
          {food.brand && <span>{food.brand}</span>}
          <span>
            {subtitle ?? (
              <>
                {fmtKcal(food.nutrients.kcal)} kcal · {fmtG(food.nutrients.protein)} g P{' '}
                <span className="faint">{basisLabel(food)}</span>
              </>
            )}
          </span>
        </div>
      </div>
      {right}
      {onToggleFavourite && (
        <button
          className={`star${favourite ? ' on' : ''}`}
          aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavourite()
          }}
        >
          {favourite ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}
