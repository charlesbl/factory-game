import React, { useState } from 'react'
import Factory from '../Game/Factory'
import IngredientsView from './IngredientsView'
import { Icon } from './Ui'

interface IFactoryProps {
    factory: Factory
    onClickEnter: () => void
    onDeleteFactory: () => void
    onCreateCustomMachine: () => void
}

const countMachines = (factory: Factory): number => factory.machines.length + factory.factories.reduce((total, child) => total + countMachines(child), 0)

const countActiveMachines = (factory: Factory): number => factory.machines.filter((machine) => machine.active).length + factory.factories.reduce((total, child) => total + countActiveMachines(child), 0)

const FactoryCardView = ({ factory, onClickEnter, onDeleteFactory, onCreateCustomMachine }: IFactoryProps): JSX.Element => {
    const [isEditTitle, setIsEditTitle] = useState(false)
    const [draftTitle, setDraftTitle] = useState(factory.name)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const machineCount = countMachines(factory)
    const activeCount = countActiveMachines(factory)

    const saveTitle = (): void => {
        const nextTitle = draftTitle.trim()
        if (nextTitle.length > 0) factory.name = nextTitle
        else setDraftTitle(factory.name)
        setIsEditTitle(false)
    }

    return (
        <article className="factory-card">
            <header className="factory-card__header">
                <span className="factory-card__icon">
                    <Icon
                        name="factory"
                        size={20}
                    />
                </span>

                <div className="factory-card__title">
                    <span className="eyebrow">
Sous-usine
                    </span>

                    {isEditTitle
                        ? (
                            <input
                                aria-label="Nom de la sous-usine"
                                autoFocus
                                className="title-input"
                                onBlur={saveTitle}
                                onChange={(event) => setDraftTitle(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') saveTitle()
                                    if (event.key === 'Escape') {
                                        setDraftTitle(factory.name)
                                        setIsEditTitle(false)
                                    }
                                }}
                                value={draftTitle}
                            />
                        )
                        : (
                            <h3>
                                {factory.name}
                            </h3>
                        )}
                </div>

                {!isEditTitle && (
                    <button
                        className="button button--icon button--quiet"
                        onClick={() => setIsEditTitle(true)}
                        title="Renommer"
                        type="button"
                    >
                        <Icon
                            name="settings"
                            size={16}
                        />
                    </button>
                )}
            </header>

            <div className="factory-card__metrics">
                <span>
                    <strong>
                        {machineCount}
                    </strong>

                    {' '}
machine

                    {machineCount !== 1 ? 's' : ''}
                </span>

                <span>
                    <strong>
                        {activeCount}
                    </strong>

                    {' '}
active

                    {activeCount !== 1 ? 's' : ''}
                </span>

                <span>
                    <strong>
                        {factory.factories.length}
                    </strong>

                    {' '}
sous-usine

                    {factory.factories.length !== 1 ? 's' : ''}
                </span>
            </div>

            <div className="factory-card__flow">
                <div>
                    <span className="recipe-label">
Entrées nettes
                    </span>

                    <IngredientsView
                        compact
                        emptyLabel="Autonome"
                        ingredients={factory.inputs}
                        kind="input"
                    />
                </div>

                <Icon name="arrow" />

                <div>
                    <span className="recipe-label">
Sorties nettes
                    </span>

                    <IngredientsView
                        compact
                        emptyLabel="Aucune"
                        ingredients={factory.outputs}
                        kind="output"
                    />
                </div>
            </div>

            <div className="factory-card__power">
                <button
                    className="power-action power-action--on"
                    onClick={() => factory.setAllMachineActive(true)}
                    type="button"
                >
                    <Icon
                        name="play"
                        size={14}
                    />

                    {' '}
Tout relancer
                </button>

                <button
                    className="power-action"
                    onClick={() => factory.setAllMachineActive(false)}
                    type="button"
                >
                    <Icon
                        name="pause"
                        size={14}
                    />

                    {' '}
Tout arrêter
                </button>
            </div>

            <footer className="factory-card__footer">
                <button
                    className="button button--primary button--grow"
                    onClick={onClickEnter}
                    type="button"
                >
                    Entrer dans l’usine
                    {' '}

                    <Icon
                        name="arrow"
                        size={16}
                    />
                </button>

                <button
                    className="button button--secondary button--icon"
                    onClick={onCreateCustomMachine}
                    title="Convertir cette usine en module réutilisable"
                    type="button"
                >
                    <Icon name="layers" />
                </button>

                <button
                    className={`button button--icon ${confirmDelete ? 'button--danger-confirm' : ''}`}
                    onBlur={() => setConfirmDelete(false)}
                    onClick={() => {
                        if (confirmDelete) onDeleteFactory()
                        else setConfirmDelete(true)
                    }}
                    title={confirmDelete ? 'Cliquer à nouveau pour confirmer' : 'Démonter la sous-usine'}
                    type="button"
                >
                    {confirmDelete ? <Icon name="check" /> : <Icon name="trash" />}
                </button>
            </footer>
        </article>
    )
}

export default FactoryCardView
