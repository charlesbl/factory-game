import React from 'react'
import Inventory from '../Game/Inventory'
import Ingredient from '../Game/Ingredient'
import { Icon, formatQuantity, getItemVisual } from './Ui'

interface IInventoryProps {
    inventory: Inventory
    inputs?: Ingredient[]
    outputs?: Ingredient[]
}

const InventoryView = ({ inventory, inputs = [], outputs = [] }: IInventoryProps): JSX.Element => {
    const inputRates = Ingredient.ingredientListToDictionary(inputs)
    const outputRates = Ingredient.ingredientListToDictionary(outputs)

    return (
        <section
            aria-labelledby="resources-title"
            className="resource-panel"
        >
            <div className="section-heading section-heading--compact">
                <div className="section-kicker">
                    <Icon
                        name="box"
                        size={15}
                    />

                    {' '}
Stock central
                </div>

                <h2 id="resources-title">
Ressources
                </h2>
            </div>

            <div className="resource-grid">
                {inventory.getItemStackList().map((itemStack) => {
                    const visual = getItemVisual(itemStack.item.id)
                    const rate = (outputRates[itemStack.item.id] ?? 0) - (inputRates[itemStack.item.id] ?? 0)
                    return (
                        <article
                            className={`resource-card${itemStack.quantity <= 0 ? ' resource-card--empty' : ''}`}
                            key={itemStack.item.id}
                        >
                            <span className={`resource-symbol resource-symbol--large resource-symbol--${visual.tone}`}>
                                {visual.code}
                            </span>

                            <span className="resource-card__body">
                                <span className="resource-card__name">
                                    {itemStack.item.name}
                                </span>

                                <strong className="resource-card__quantity">
                                    {formatQuantity(itemStack.quantity)}
                                </strong>
                            </span>

                            {rate !== 0
                                ? (
                                    <span className={`rate-badge ${rate > 0 ? 'rate-badge--positive' : 'rate-badge--negative'}`}>
                                        {rate > 0 ? '+' : ''}

                                        {formatQuantity(rate, 2)}
/s
                                    </span>
                                )
                                : (
                                    <span className="rate-badge rate-badge--neutral">
—
                                    </span>
                                )}
                        </article>
                    )
                })}
            </div>
        </section>
    )
}

export default InventoryView
