import React from 'react'
import FactoryView from './FactoryView'
import IBaseProps from './IBaseProps'
import Factory from '../Game/Factory'
import InventoryView from './InventoryView'
import ManualMachineView from './ManualMachineView'
import FactoryNavigationView from './FactoryNavigationView'
import useLocalStorageState from 'use-local-storage-state'
import { Icon } from './Ui'

interface IGameViewProps extends IBaseProps {
    onReset: () => void
    onGrantResources: () => void
}

interface IFactoryStats {
    factories: number
    machines: number
    active: number
}

interface IFactoryDestination {
    factory: Factory
    path: Factory[]
    depth: number
}

const getFactoryStats = (factory: Factory): IFactoryStats => factory.factories.reduce<IFactoryStats>((stats, child) => {
    const childStats = getFactoryStats(child)
    return {
        factories: stats.factories + childStats.factories + 1,
        machines: stats.machines + childStats.machines,
        active: stats.active + childStats.active
    }
}, {
    factories: 0,
    machines: factory.machines.length,
    active: factory.machines.filter((machine) => machine.active).length
})

const getFactoryDestinations = (factory: Factory, parentPath: Factory[] = [], depth = 0): IFactoryDestination[] => {
    const path = [...parentPath, factory]
    return [
        { factory, path, depth },
        ...factory.factories.flatMap((child) => getFactoryDestinations(child, path, depth + 1))
    ]
}

const GameView = ({ game, onReset, onGrantResources }: IGameViewProps): JSX.Element => {
    const [factories, setFactories] = React.useState<Factory[]>([game.factory])
    const [showManualMachines, setShowManualMachines] = useLocalStorageState('showManualMachines', { defaultValue: true })
    const currentFactory = factories[factories.length - 1]
    const stats = getFactoryStats(game.factory)
    const destinations = getFactoryDestinations(game.factory)
    const currentDestinationIndex = destinations.findIndex(({ factory }) => factory === currentFactory)

    const navigateToLevel = (index: number): void => {
        setFactories(factories.slice(0, index + 1))
    }

    return (
        <div className="game-shell">
            <header className="topbar">
                <div className="brand">
                    <span className="brand__mark">
                        <Icon
                            name="factory"
                            size={23}
                        />
                    </span>

                    <div>
                        <strong>
FOUNDRY
                        </strong>

                        <span>
Console de production
                        </span>
                    </div>
                </div>

                <div className="topbar__status">
                    <span className="live-indicator">
                        <i />

                        {' '}
Système en ligne
                    </span>

                    <span className="save-indicator">
Sauvegarde automatique
                    </span>
                </div>

                <div className="topbar__actions">
                    <details className="utility-menu">
                        <summary
                            aria-label="Ouvrir les paramètres"
                            className="button button--icon"
                        >
                            <Icon name="settings" />
                        </summary>

                        <div className="utility-menu__popover">
                            <span className="eyebrow">
Utilitaires
                            </span>

                            <button
                                onClick={onGrantResources}
                                type="button"
                            >
                                <Icon
                                    name="spark"
                                    size={16}
                                />

                                {' '}
Livraison d’essai
                            </button>

                            <button
                                className="danger-link"
                                onClick={onReset}
                                type="button"
                            >
                                <Icon
                                    name="trash"
                                    size={16}
                                />

                                {' '}
Réinitialiser la partie
                            </button>
                        </div>
                    </details>
                </div>
            </header>

            <main className="game-main">
                <section className="command-header">
                    <div>
                        <span className="section-kicker">
Centre de contrôle
                        </span>

                        <h1>
Pilotage des usines
                        </h1>
                    </div>

                    <div className="command-stats">
                        <div>
                            <span>
Machines
                            </span>

                            <strong>
                                {stats.machines}
                            </strong>
                        </div>

                        <div>
                            <span>
En service
                            </span>

                            <strong className="positive-text">
                                {stats.active}
                            </strong>
                        </div>

                        <div>
                            <span>
Sous-usines
                            </span>

                            <strong>
                                {stats.factories}
                            </strong>
                        </div>
                    </div>
                </section>

                <InventoryView
                    inputs={game.factory.inputs}
                    inventory={game.inventory}
                    outputs={game.factory.outputs}
                />

                <section className={`manual-workshop${showManualMachines ? '' : ' manual-workshop--collapsed'}`}>
                    <button
                        aria-expanded={showManualMachines}
                        className="manual-workshop__toggle"
                        onClick={() => setShowManualMachines(!showManualMachines)}
                        type="button"
                    >
                        <span className="manual-workshop__icon">
                            <Icon
                                name="hammer"
                                size={21}
                            />
                        </span>

                        <span>
                            <small>
Amorçage
                            </small>

                            <strong>
Atelier manuel
                            </strong>
                        </span>

                        <span className="manual-workshop__hint">
Maintenez un bouton pour produire les premières ressources.
                        </span>

                        <Icon
                            className="manual-workshop__chevron"
                            name="chevron"
                        />
                    </button>

                    {showManualMachines && (
                        <div className="manual-grid">
                            {game.manualMachines.map((machine) => (
                                <ManualMachineView
                                    inventory={game.inventory}
                                    key={machine.machineCraft.id}
                                    machine={machine}
                                />
                            ))}
                        </div>
                    )}
                </section>

                <FactoryView
                    craftManager={game.craftManager}
                    factory={currentFactory}
                    inventory={game.inventory}
                    navigation={(
                        <FactoryNavigationView
                            currentDestinationIndex={currentDestinationIndex}
                            destinations={destinations}
                            factories={factories}
                            onNavigateToLevel={navigateToLevel}
                            onNavigateToPath={setFactories}
                        />
                    )}
                    onSelectedFactory={(factory) => setFactories([...factories, factory])}
                />
            </main>
        </div>
    )
}

export default GameView
