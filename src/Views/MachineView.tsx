import React, { useState } from 'react'
import Machine from '../Game/Machine'
import IngredientsView from './IngredientsView'
import { Icon, getItemVisual } from './Ui'

interface IMachineProps {
    machine: Machine
    onDeleteMachine: () => void
    onTogglePauseMachine: () => void
}

const MachineView = ({ machine, onDeleteMachine, onTogglePauseMachine }: IMachineProps): JSX.Element => {
    const [confirmDelete, setConfirmDelete] = useState(false)
    const product = machine.craft.output[0]?.item
    const visual = getItemVisual(product?.id ?? '')

    return (
        <article className={`machine-card${machine.active ? ' machine-card--active' : ' machine-card--paused'}`}>
            <div className="machine-card__status-line" />

            <header className="machine-card__header">
                <span className={`resource-symbol resource-symbol--large resource-symbol--${visual.tone}`}>
                    {visual.code}
                </span>

                <div className="machine-card__title">
                    <span className="eyebrow">
Unité de production
                    </span>

                    <h3>
                        {machine.name}
                    </h3>
                </div>

                <span className={`status-badge ${machine.active ? 'status-badge--active' : 'status-badge--paused'}`}>
                    <span className="status-dot" />

                    {machine.active ? 'En service' : 'À l’arrêt'}
                </span>
            </header>

            <div className={`activity-track${machine.active ? ' activity-track--running' : ''}`}>
                <span />
            </div>

            <div className="machine-card__recipe">
                <div className="recipe-column">
                    <span className="recipe-label">
Consomme
                    </span>

                    <IngredientsView
                        emptyLabel="Aucun intrant"
                        ingredients={machine.craft.input}
                        kind="input"
                    />
                </div>

                <span className="recipe-arrow">
                    <Icon name="arrow" />
                </span>

                <div className="recipe-column recipe-column--output">
                    <span className="recipe-label">
Produit
                    </span>

                    <IngredientsView
                        ingredients={machine.craft.output}
                        kind="output"
                    />
                </div>
            </div>

            <footer className="machine-card__footer">
                <button
                    className="button button--secondary button--grow"
                    onClick={onTogglePauseMachine}
                    type="button"
                >
                    <Icon
                        name={machine.active ? 'pause' : 'play'}
                        size={16}
                    />

                    {machine.active ? 'Arrêter' : 'Relancer'}
                </button>

                <button
                    className={`button button--icon ${confirmDelete ? 'button--danger-confirm' : ''}`}
                    onBlur={() => setConfirmDelete(false)}
                    onClick={() => {
                        if (confirmDelete) onDeleteMachine()
                        else setConfirmDelete(true)
                    }}
                    title={confirmDelete ? 'Cliquer à nouveau pour confirmer' : 'Démonter la machine'}
                    type="button"
                >
                    {confirmDelete ? <Icon name="check" /> : <Icon name="trash" />}

                    <span className="sr-only">
                        {confirmDelete ? 'Confirmer le démontage' : 'Démonter la machine'}
                    </span>
                </button>
            </footer>
        </article>
    )
}

export default MachineView
