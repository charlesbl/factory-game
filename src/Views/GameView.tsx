import React, { useState } from 'react'
import FactoryView from './FactoryView'
import IBaseProps from './IBaseProps'
import Factory from '../Game/Factory'
import InventoryView from './InventoryView'
import SelectMachineView from './SelectMachineView'
import MachineCraft from '../Game/MachineCraft'
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
    const [selectedMachineCraft, selectMachineCraft] = useState<MachineCraft | undefined>(undefined)
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
            <FactoryView
                game={props.game}
                factory={currentFactory}
                onSelectedFactory={(factory) => {
                    setFactories([...factories, factory])
                }}
                onUpdateFactoryIO={() => {
                    currentFactory.updateInputsAndOutputs()
                    factories.reduceRight((_, factory) => {
                        factory.updateInputsAndOutputs()
                        return factory
                    })
                }}/>

            <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2">
                <button className="btn btn-primary"
                    onClick={() => currentFactory.addSubFactory()}>
                        Add factory
                </button>
                <SelectMachineView onChange={(machineCraft) => selectMachineCraft(machineCraft)} />
                <button className="btn btn-primary"
                    onClick={() => {
                        if (selectedMachineCraft === undefined) return
                        currentFactory.buildMachine(selectedMachineCraft)
                    }}>
                        Add machine
                </button>
            </div>
        </div>
    )
}

export default GameView
