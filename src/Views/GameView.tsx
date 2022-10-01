import React, { useState } from 'react'
import FactoryView from './FactoryView'
import IBaseProps from './IBaseProps'
import Factory from '../Game/Factory'
import InventoryView from './InventoryView'
import SelectMachineView from './SelectMachineView'
import Machine from '../Game/Machine'
import MachineView from './MachineView'

const renderManualMachine = (machine: Machine, index: number): JSX.Element => {
    return (
        <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
            <MachineView machine={machine} manual={true}/>
        </div>
    )
}

const GameView = (props: IBaseProps): JSX.Element => {
    const [factories, setFactories] = useState<Factory[]>([props.game.factory])
    const currentFactory = factories[factories.length - 1]

    const manualMachines = props.game.manualMachines.map((machine, i) => renderManualMachine(machine, i))

    return (
        <div>
            <span>{props.game.money.toFixed(2)}€</span>
            <InventoryView inventory={props.game.inventory} />

            <div className="row">
                {manualMachines}
            </div>
            <button className="btn btn-primary"
                disabled={factories.length === 1}
                onClick={() => {
                    factories.pop()
                    setFactories([...factories])
                }}>
                    Return
            </button>

            <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2">
                <SelectMachineView onAddClicked={(mc) => {
                    currentFactory.buildMachine(mc)
                }}/>
                <button className="btn btn-primary" onClick={() => currentFactory.addSubFactory()}>
                        Add factory
                </button>
            </div>

            <FactoryView
                game={props.game}
                factory={currentFactory}
                onSelectedFactory={(factory) => {
                    setFactories([...factories, factory])
                }}/>
        </div>
    )
}

export default GameView
