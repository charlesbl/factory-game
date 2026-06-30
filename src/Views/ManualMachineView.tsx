import React from 'react'
import Inventory from '../Game/Inventory'
import Machine from '../Game/Machine'
import IngredientsView from './IngredientsView'
import { Icon, getItemVisual } from './Ui'

interface IManualMachineProps {
    machine: Machine
    inventory: Inventory
}

const ManualMachineView = ({ machine, inventory }: IManualMachineProps): JSX.Element => {
    const canCraft = machine.craft.canCraft(inventory, 1)
    const product = machine.craft.output[0]?.item
    const visual = getItemVisual(product?.id ?? '')

    const startCrafting = (): void => { machine.active = canCraft }
    const stopCrafting = (): void => { machine.active = false }

    return (
        <article className={`manual-card${canCraft ? '' : ' manual-card--disabled'}`}>
            <div className="manual-card__header">
                <span className={`resource-symbol resource-symbol--${visual.tone}`}>
                    {visual.code}
                </span>

                <div>
                    <h3>
                        {machine.name}
                    </h3>

                    <span>
                        {canCraft ? 'Prêt à produire' : 'Ressources insuffisantes'}
                    </span>
                </div>
            </div>

            <div className="recipe-flow recipe-flow--manual">
                <IngredientsView
                    compact
                    emptyLabel="Sans intrant"
                    ingredients={machine.craft.input}
                    inventory={inventory}
                    kind="cost"
                />

                <Icon
                    name="arrow"
                    size={16}
                />

                <IngredientsView
                    compact
                    ingredients={machine.craft.output}
                    kind="output"
                />
            </div>

            <button
                className="button button--craft"
                disabled={!canCraft}
                onBlur={stopCrafting}
                onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') startCrafting() }}
                onKeyUp={stopCrafting}
                onPointerCancel={stopCrafting}
                onPointerDown={startCrafting}
                onPointerLeave={stopCrafting}
                onPointerUp={stopCrafting}
                type="button"
            >
                <Icon name="hammer" />
                Maintenir pour produire
            </button>
        </article>
    )
}

export default ManualMachineView
