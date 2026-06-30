import React, { useState } from 'react'
import MachineCraft from '../Game/MachineCraft'
import Inventory from '../Game/Inventory'
import IngredientsView from './IngredientsView'
import { Icon, getItemVisual } from './Ui'

interface IMachineCraftProps {
    machineCraft: MachineCraft
    inventory: Inventory
    onAdd: (machineCraft: MachineCraft) => void
    onRemove: (machineCraft: MachineCraft) => void
}

const MachineCraftView = ({ machineCraft, inventory, onAdd, onRemove }: IMachineCraftProps): JSX.Element => {
    const [confirmDelete, setConfirmDelete] = useState(false)
    const affordable = machineCraft.canCraft(inventory)
    const product = machineCraft.outputCraft.output[0]?.item
    const visual = getItemVisual(product?.id ?? '')

    return (
        <article className={`blueprint-card${affordable ? '' : ' blueprint-card--locked'}`}>
            <header className="blueprint-card__header">
                <span className={`resource-symbol resource-symbol--${visual.tone}`}>
                    {visual.code}
                </span>

                <div>
                    <h3>
                        {machineCraft.name}
                    </h3>

                    <span>
                        {machineCraft.isCustom ? 'Module personnalisé' : `Produit ${product?.name ?? 'une ressource'}`}
                    </span>
                </div>

                {affordable && (
                    <span
                        className="availability-dot"
                        title="Constructible"
                    />
                )}
            </header>

            <div className="blueprint-card__flow">
                <IngredientsView
                    compact
                    emptyLabel="Extraction"
                    ingredients={machineCraft.outputCraft.input}
                    kind="input"
                />

                <Icon
                    name="arrow"
                    size={15}
                />

                <IngredientsView
                    compact
                    ingredients={machineCraft.outputCraft.output}
                    kind="output"
                />
            </div>

            <div className="blueprint-card__cost">
                <span className="recipe-label">
Coût de construction
                </span>

                <IngredientsView
                    compact
                    ingredients={machineCraft.input}
                    inventory={inventory}
                    kind="cost"
                />
            </div>

            <div className="blueprint-card__actions">
                <button
                    className="button button--primary button--grow"
                    disabled={!affordable}
                    onClick={() => onAdd(machineCraft)}
                    type="button"
                >
                    <Icon
                        name="plus"
                        size={16}
                    />

                    {affordable ? 'Construire' : 'Stock insuffisant'}
                </button>

                {machineCraft.isCustom && (
                    <button
                        className={`button button--icon ${confirmDelete ? 'button--danger-confirm' : ''}`}
                        onBlur={() => setConfirmDelete(false)}
                        onClick={() => {
                            if (confirmDelete) onRemove(machineCraft)
                            else setConfirmDelete(true)
                        }}
                        title="Supprimer ce plan personnalisé"
                        type="button"
                    >
                        {confirmDelete ? <Icon name="check" /> : <Icon name="trash" />}
                    </button>
                )}
            </div>
        </article>
    )
}

export default MachineCraftView
