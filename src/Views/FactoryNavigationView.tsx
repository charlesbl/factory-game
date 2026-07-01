import React from 'react'
import Factory from '../Game/Factory'
import { Icon } from './Ui'

interface IFactoryDestination {
    factory: Factory
    path: Factory[]
    depth: number
}

interface IFactoryNavigationProps {
    factories: Factory[]
    destinations: IFactoryDestination[]
    currentDestinationIndex: number
    onNavigateToLevel: (index: number) => void
    onNavigateToPath: (path: Factory[]) => void
}

const FactoryNavigationView = ({ factories, destinations, currentDestinationIndex, onNavigateToLevel, onNavigateToPath }: IFactoryNavigationProps): JSX.Element => (
    <section
        aria-label="Navigation entre les usines"
        className="factory-navigation factory-navigation--embedded"
    >
        <button
            className="button button--secondary factory-navigation__back"
            disabled={factories.length === 1}
            onClick={() => onNavigateToLevel(factories.length - 2)}
            type="button"
        >
            <Icon
                name="back"
                size={17}
            />
            Usine parente
        </button>

        <div className="factory-navigation__current">
            <span className="factory-navigation__label">
Usine actuelle
            </span>

            <nav
                aria-label="Chemin de l’usine actuelle"
                className="breadcrumbs"
            >
                {factories.map((factory, index) => (
                    <React.Fragment key={index}>
                        {index > 0 && (
                            <Icon
                                name="chevron"
                                size={14}
                            />
                        )}

                        <button
                            aria-current={index === factories.length - 1 ? 'page' : undefined}
                            onClick={() => onNavigateToLevel(index)}
                            type="button"
                        >
                            {factory.name}
                        </button>
                    </React.Fragment>
                ))}
            </nav>
        </div>

        <label className="factory-switcher">
            <span>
Changer d’usine
            </span>

            <span className="factory-switcher__control">
                <Icon
                    name="factory"
                    size={16}
                />

                <select
                    aria-label="Sélectionner une usine"
                    onChange={(event) => {
                        const destination = destinations[Number(event.target.value)]
                        if (destination !== undefined) onNavigateToPath(destination.path)
                    }}
                    value={currentDestinationIndex}
                >
                    {destinations.map((destination, index) => (
                        <option
                            key={index}
                            value={index}
                        >
                            {`${'— '.repeat(destination.depth)}${destination.factory.name}`}
                        </option>
                    ))}
                </select>

                <Icon
                    name="chevron"
                    size={15}
                />
            </span>
        </label>
    </section>
)

export default FactoryNavigationView
