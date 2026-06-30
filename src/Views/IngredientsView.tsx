import React from 'react'
import Ingredient from '../Game/Ingredient'
import Inventory from '../Game/Inventory'
import { formatQuantity, getItemVisual } from './Ui'

interface IItemsCraftProps {
    ingredients: Ingredient[]
    kind?: 'input' | 'output' | 'cost' | 'neutral'
    inventory?: Inventory
    compact?: boolean
    emptyLabel?: string
}

const IngredientsView = ({ ingredients, kind = 'neutral', inventory, compact = false, emptyLabel = 'Aucune ressource' }: IItemsCraftProps): JSX.Element => {
    if (ingredients.length === 0) {
        return (
            <span className="ingredient-empty">
                {emptyLabel}
            </span>
        )
    }

    return (
        <div className={`ingredient-list ingredient-list--${kind}${compact ? ' ingredient-list--compact' : ''}`}>
            {ingredients.map((ingredient) => {
                const visual = getItemVisual(ingredient.item.id)
                const stock = inventory?.getQuantity(ingredient.item)
                const isMissing = stock !== undefined && stock < ingredient.quantityPerSecond
                return (
                    <div
                        className={`ingredient-chip${isMissing ? ' ingredient-chip--missing' : ''}`}
                        key={ingredient.item.id}
                        title={ingredient.item.name}
                    >
                        <span className={`resource-symbol resource-symbol--${visual.tone}`}>
                            {visual.code}
                        </span>

                        {!compact && (
                            <span className="ingredient-name">
                                {ingredient.item.name}
                            </span>
                        )}

                        <strong>
                            {formatQuantity(ingredient.quantityPerSecond, 2)}

                            {kind === 'input' || kind === 'output' ? '/s' : ''}
                        </strong>

                        {stock !== undefined && kind === 'cost' && (
                            <span className="ingredient-stock">
/
                                {formatQuantity(stock)}
                            </span>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

export default IngredientsView
