import React, { useState } from 'react'
import FactoryView from './FactoryView'
import IBaseProps from './IBaseProps'
import Factory from '../Game/Factory'
import InventoryView from './InventoryView'
import ManualMachineView from './ManualMachineView'
import '../css/Game.css'

const GameView = (props: IBaseProps): JSX.Element => {
    const [factories, setFactories] = useState<Factory[]>([props.game.factory])
    const [showManualMachines, setShowManualMachines] = useState(true)
    const currentFactory = factories[factories.length - 1]
    const isMainFactory = factories.length === 1

    return (
        <div>
            <span>
                {props.game.money.toFixed(2)}
                €
            </span>

            <InventoryView inventory={props.game.inventory} />

            <button
                className="btn btn-primary"
                onClick={() => setShowManualMachines(!showManualMachines)}
            >
                    toggle manual machines
            </button>

            <div className={`row ${showManualMachines ? '' : 'hide'}`}>
                { props.game.manualMachines.map((machine, i) => {
                    return (
                        <div
                            className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container"
                            key={i}
                        >
                            <ManualMachineView
                                inventory={props.game.inventory}
                                machine={machine}
                            />
                        </div>
                    )
                })}
            </div>

            <button
                className="btn btn-primary"
                disabled={isMainFactory}
                onClick={() => {
                    factories.pop()
                    setFactories([...factories])
                }}
            >
                    Return
            </button>

            <FactoryView
                craftManager={props.game.craftManager}
                factory={currentFactory}
                inventory={props.game.inventory}
                onSelectedFactory={(factory) => {
                    setFactories([...factories, factory])
                }}
            />
        </div>
    )
}

export default GameView
