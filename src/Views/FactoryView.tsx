import React from 'react'
import Factory from '../Game/Factory'
import MachineView from './MachineView'
import FactoryCardView from './FactoryCardView'
import CraftManager from '../Game/CraftManager'
import Inventory from '../Game/Inventory'
import SelectMachineView from './SelectMachineView'
import IngredientsView from './IngredientsView'
import { Icon } from './Ui'

interface IFactoryProps {
    factory: Factory
    onSelectedFactory: (factory: Factory) => void
    craftManager: CraftManager
    inventory: Inventory
}

const FactoryView = ({ factory, onSelectedFactory, craftManager, inventory }: IFactoryProps): JSX.Element => {
    const activeMachines = factory.machines.filter((machine) => machine.active).length
    const totalUnits = factory.machines.length + factory.factories.length

    return (
        <section className="factory-workspace">
            <SelectMachineView
                inventory={inventory}
                machineCrafts={craftManager.machineCrafts}
                onAdd={(machineCraft) => { machineCraft.tryConsumeMachineCraft(inventory, factory) }}
                onRemove={(machineCraft) => {
                    craftManager.removeMachineCraft(machineCraft.id)
                    craftManager.removeCraft(machineCraft.outputCraft.id)
                }}
            />

            <div className="factory-floor">
                <header className="floor-header">
                    <div>
                        <span className="section-kicker">
                            <Icon
                                name="factory"
                                size={15}
                            />

                            {' '}
Usine active
                        </span>

                        <h2>
                            {factory.name}
                        </h2>

                        <p>
Supervisez les machines et organisez la production en sous-usines.
                        </p>
                    </div>

                    <button
                        className="button button--primary"
                        onClick={() => factory.addSubFactory()}
                        type="button"
                    >
                        <Icon
                            name="plus"
                            size={17}
                        />
                        Nouvelle sous-usine
                    </button>
                </header>

                <div className="floor-summary">
                    <div className="summary-stat">
                        <span>
Éléments dans l’usine
                        </span>

                        <strong>
                            {totalUnits}
                        </strong>
                    </div>

                    <div className="summary-stat">
                        <span>
Machines en service
                        </span>

                        <strong>
                            {activeMachines}

                            <small>
                                {' '}

/
                                {factory.machines.length}
                            </small>
                        </strong>
                    </div>

                    <div className="flow-summary">
                        <div>
                            <span className="recipe-label">
Demande externe
                            </span>

                            <IngredientsView
                                compact
                                emptyLabel="Aucune"
                                ingredients={factory.inputs}
                                kind="input"
                            />
                        </div>

                        <Icon
                            name="arrow"
                            size={17}
                        />

                        <div>
                            <span className="recipe-label">
Production nette
                            </span>

                            <IngredientsView
                                compact
                                emptyLabel="Aucune"
                                ingredients={factory.outputs}
                                kind="output"
                            />
                        </div>
                    </div>
                </div>

                {totalUnits === 0
                    ? (
                        <div className="floor-empty">
                            <span className="floor-empty__icon">
                                <Icon
                                    name="factory"
                                    size={34}
                                />
                            </span>

                            <div>
                                <span className="eyebrow">
Usine vide
                                </span>

                                <h3>
Votre chaîne de production commence ici
                                </h3>

                                <p>
Utilisez le catalogue pour construire une machine, ou créez une sous-usine pour regrouper une chaîne complète.
                                </p>
                            </div>

                            <div className="starter-steps">
                                <span>
                                    <b>
1
                                    </b>

                                    {' '}
Produisez manuellement
                                </span>

                                <span>
                                    <b>
2
                                    </b>

                                    {' '}
Réunissez le coût
                                </span>

                                <span>
                                    <b>
3
                                    </b>

                                    {' '}
Construisez une machine
                                </span>
                            </div>
                        </div>
                    )
                    : (
                        <div className="floor-content">
                            {factory.factories.length > 0 && (
                                <section className="floor-group">
                                    <div className="floor-group__heading">
                                        <div>
                                            <Icon
                                                name="layers"
                                                size={17}
                                            />

                                            <h3>
Sous-usines
                                            </h3>
                                        </div>

                                        <span>
                                            {factory.factories.length}
                                        </span>
                                    </div>

                                    <div className="card-grid card-grid--factories">
                                        {factory.factories.map((subFactory, index) => (
                                            <FactoryCardView
                                                factory={subFactory}
                                                key={index}
                                                onClickEnter={() => onSelectedFactory(subFactory)}
                                                onCreateCustomMachine={() => {
                                                    const machineCraft = craftManager.createCustomMachineFromFactory(subFactory)
                                                    factory.dismantleSubFactory(subFactory, inventory)
                                                    machineCraft.tryConsumeMachineCraft(inventory, factory)
                                                }}
                                                onDeleteFactory={() => factory.dismantleSubFactory(subFactory, inventory)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {factory.machines.length > 0 && (
                                <section className="floor-group">
                                    <div className="floor-group__heading">
                                        <div>
                                            <Icon
                                                name="wrench"
                                                size={17}
                                            />

                                            <h3>
Machines
                                            </h3>
                                        </div>

                                        <span>
                                            {factory.machines.length}
                                        </span>
                                    </div>

                                    <div className="card-grid">
                                        {factory.machines.map((machine, index) => (
                                            <MachineView
                                                key={index}
                                                machine={machine}
                                                onDeleteMachine={() => factory.dismantleMachine(machine, inventory)}
                                                onTogglePauseMachine={() => factory.togglePauseMachine(machine)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}
                        </div>
                    )}
            </div>
        </section>
    )
}

export default FactoryView
