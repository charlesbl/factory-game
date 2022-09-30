import React, { useState } from 'react'
import FactoryView from './FactoryView'
import IBaseProps from './IBaseProps'
import Factory from '../Game/Factory'
import InventoryView from './InventoryView'
import SelectMachineView from './SelectMachineView'
import MachineCraft from '../Game/MachineCraft'

const GameView = (props: IBaseProps): JSX.Element => {
    const [selectedMachineCraft, selectMachineCraft] = useState<MachineCraft | undefined>(undefined)
    const [factories, setFactories] = useState<Factory[]>([props.game.factory])
    const currentFactory = factories[factories.length - 1]

    return (
        <div>
            <span>{props.game.money.toFixed(2)}€</span>
            <InventoryView inventory={props.game.inventory} />
            {factories.length > 1 && <button className="btn btn-primary"
                onClick={() => {
                    factories.pop()
                    setFactories([...factories])
                }}>
                    Return
            </button>}
            <FactoryView
                game={props.game}
                factory={currentFactory}
                onSelectedFactory={(factory) => {
                    setFactories([...factories, factory])
                }}
                onUpdateFactoryIO={() => {
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
