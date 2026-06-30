import React, { useState } from 'react'
import Inventory from '../Game/Inventory'
import MachineCraft from '../Game/MachineCraft'
import MachineCraftView from './MachineCraftView'
import { Icon } from './Ui'

interface ISelectMachineProps {
    machineCrafts: MachineCraft[]
    inventory: Inventory
    onAdd: (machineCraft: MachineCraft) => void
    onRemove: (machineCraft: MachineCraft) => void
}

const SelectMachineView = ({ machineCrafts, inventory, onAdd, onRemove }: ISelectMachineProps): JSX.Element => {
    const [query, setQuery] = useState('')
    const [onlyAffordable, setOnlyAffordable] = useState(false)
    const visibleMachineCrafts = machineCrafts.filter((machineCraft) => {
        const matchesQuery = machineCraft.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
        return matchesQuery && (!onlyAffordable || machineCraft.canCraft(inventory))
    })

    return (
        <aside
            aria-labelledby="build-title"
            className="build-panel"
        >
            <div className="build-panel__heading">
                <div>
                    <span className="section-kicker">
                        <Icon
                            name="wrench"
                            size={15}
                        />

                        {' '}
Catalogue
                    </span>

                    <h2 id="build-title">
Construction
                    </h2>
                </div>

                <span className="count-badge">
                    {visibleMachineCrafts.length}
                </span>
            </div>

            <label className="search-field">
                <Icon
                    name="search"
                    size={17}
                />

                <span className="sr-only">
Rechercher un plan
                </span>

                <input
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Rechercher un plan…"
                    type="search"
                    value={query}
                />
            </label>

            <button
                aria-pressed={onlyAffordable}
                className={`filter-toggle${onlyAffordable ? ' filter-toggle--active' : ''}`}
                onClick={() => setOnlyAffordable(!onlyAffordable)}
                type="button"
            >
                <span className="filter-check">
                    {onlyAffordable && (
                        <Icon
                            name="check"
                            size={13}
                        />
                    )}
                </span>
                Afficher uniquement les plans constructibles
            </button>

            <div className="blueprint-list">
                {visibleMachineCrafts.map((machineCraft) => (
                    <MachineCraftView
                        inventory={inventory}
                        key={machineCraft.id}
                        machineCraft={machineCraft}
                        onAdd={onAdd}
                        onRemove={onRemove}
                    />
                ))}

                {visibleMachineCrafts.length === 0 && (
                    <div className="panel-empty">
                        <Icon name="search" />

                        <span>
Aucun plan ne correspond à ce filtre.
                        </span>
                    </div>
                )}
            </div>
        </aside>
    )
}

export default SelectMachineView
