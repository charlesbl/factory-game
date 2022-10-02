import React, { useState } from 'react'
import FactoryView from './FactoryView'
import IBaseProps from './IBaseProps'
import Factory from '../Game/Factory'
import InventoryView from './InventoryView'
import SelectMachineView from './SelectMachineView'
import ManualMachineView from './ManualMachineView'

const GameView = (props: IBaseProps): JSX.Element => {
    const [factories, setFactories] = useState<Factory[]>([props.game.factory])
    const currentFactory = factories[factories.length - 1]
    const isMainFactory = factories.length === 1

    return (
        <div>
            <span>{props.game.money.toFixed(2)}€</span>
            <InventoryView inventory={props.game.inventory} />

            <div className="row">
                {props.game.manualMachines.map((machine, i) => {
                    return <div key={i} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
                        <ManualMachineView machine={machine} inventory={props.game.inventory}/>
                    </div>
                })}
            </div>

            <div className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2">
                <SelectMachineView inventory={props.game.inventory} craftManager={props.game.craftManager} onAddClicked={(mc) => {
                    props.game.tryConsumeMachineCraft(mc, currentFactory)
                }}/>
                <button className="btn btn-primary" onClick={() => currentFactory.addSubFactory()}>
                        Add new factory
                </button>
            </div>

            <button className="btn btn-primary"
                disabled={isMainFactory}
                onClick={() => {
                    factories.pop()
                    setFactories([...factories])
                }}>
                    Return
            </button>

            <FactoryView
                factory={currentFactory}
                isMainFactory={isMainFactory}
                craftManager={props.game.craftManager}
                inventory={props.game.inventory}
                onSelectedFactory={(factory) => {
                    setFactories([...factories, factory])
                }}/>
        </div>
    )
}

export default GameView
