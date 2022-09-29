import React, { useState } from 'react'
import '../css/Factory.css'
import Factory from '../Game/Factory'
import Machine from '../Game/Machine'
import MachineView from './MachineView'
import FactoryCardView from './FactoryCardView'
import IBaseProps from './IBaseProps'
import SelectMachineView from './SelectMachineView'
import MachineCraft from '../Game/MachineCraft'
import InventoryView from './InventoryView'
import { notImplemented } from '..'

interface IFactoryProps extends IBaseProps {
    factory: Factory
    onSelectedFactory: (factory: Factory) => void
    onGoBack: () => void
}

const renderMachine = (machine: Machine, index: number): JSX.Element => {
    return (
        <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
            <MachineView machine={machine} />
        </div>
    )
}

const renderFactoryCard = (factory: Factory, index: number, onSelectedFactory: (factory: Factory) => void): JSX.Element => {
    return (
        <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
            <FactoryCardView factory={factory} onClickEnter={() => onSelectedFactory(factory)} />
        </div>
    )
}

const FactoryView = (props: IFactoryProps): JSX.Element => {
    const [selectedMachineCraft, selectMachineCraft] = useState<MachineCraft | undefined>(undefined)

    const machines = props.factory.machines.map((machine, i) => renderMachine(machine, i))
    const factories = props.factory.factories.map((factory, i) => renderFactoryCard(factory, i, props.onSelectedFactory))
    const returnButton = <button className="btn btn-primary" onClick={() => props.onGoBack()}>Return</button>
    return (
        <div>
            <InventoryView game={props.game} inventory={props.game.inventory} />
            {returnButton}
            <div className="row">
                {machines}
            </div>
            <div className="row">
                {factories}
            </div>
            <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2 machine-container">
                <button className="btn btn-primary"
                    onClick={() => props.factory.addSubFactory()}>Add factory</button>
                <SelectMachineView onChange={(machineCraft) => selectMachineCraft(machineCraft)} />
                <button className="btn btn-primary"
                    onClick={() => {
                        console.log(selectedMachineCraft)
                        notImplemented()
                    }}>Add machine</button>
            </div>
        </div>
    )
}

export default FactoryView
