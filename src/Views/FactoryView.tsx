import React from 'react'
import '../css/Factory.css'
import Factory from '../Game/Factory'
import MachineView from './MachineView'
import FactoryCardView from './FactoryCardView'
import CraftManager from '../Game/CraftManager'
import Inventory from '../Game/Inventory'
import SelectMachineView from './SelectMachineView'

interface IFactoryProps {
    factory: Factory
    isMainFactory: boolean
    onSelectedFactory: (factory: Factory) => void
    craftManager: CraftManager
    inventory: Inventory
}

const FactoryView = (props: IFactoryProps): JSX.Element => {
    return (
        <div className='main-factory'>
            <h1>{props.factory.name}</h1>

            <div className="row">
                <div className="col-3">

                    {/* <button className="btn btn-primary" onClick={() => props.factory.updateInputsAndOutputs()}>Refresh</button> */}

                    <button className="btn btn-primary" onClick={() => props.factory.addSubFactory()}>
                        Add new factory
                    </button>
                    <SelectMachineView
                        machineCrafts={props.craftManager.machineCrafts}
                        inventory={props.inventory}
                        onAdd={(mc) => mc.tryConsumeMachineCraft(props.inventory, props.factory)}
                        onRemove={(mc) => {
                            props.craftManager.removeMachineCraft(mc.id)
                            props.craftManager.removeCraft(mc.outputCraft.id)
                        }}/>
                </div>
                <div className="col-9">
                    <div className="row">
                        {props.factory.factories.map((subFactory, i) => {
                            return <div key={i} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-3 machine-container">
                                <FactoryCardView factory={subFactory}
                                    onClickEnter={() => props.onSelectedFactory(subFactory)}
                                    onDeleteFactory={() => props.factory.dismantleSubFactory(subFactory, props.inventory)}
                                    onCreateCustomMachine={() => {
                                        const machineCraft = props.craftManager.createCustomMachineFromFactory(subFactory)
                                        props.factory.dismantleSubFactory(subFactory, props.inventory)
                                        machineCraft.tryConsumeMachineCraft(props.inventory, props.factory)
                                    }} />
                            </div>
                        })}
                        {props.factory.machines.map((machine, i) => {
                            return <div key={i} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-3 machine-container">
                                <MachineView machine={machine}
                                    onDeleteMachine={() => {
                                        props.factory.dismantleMachine(machine, props.inventory)
                                    }}
                                    onTogglePauseMachine={() => props.factory.togglePauseMachine(machine)}/>
                            </div>
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default FactoryView
