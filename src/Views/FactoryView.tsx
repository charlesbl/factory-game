import React from 'react'
import '../css/Factory.css'
import Factory from '../Game/Factory'
import MachineView from './MachineView'
import FactoryCardView from './FactoryCardView'
import Craft from '../Game/Craft'
import CraftManager from '../Game/CraftManager'
import MachineCraft from '../Game/MachineCraft'
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
                    <button className="btn btn-primary"
                        disabled={props.isMainFactory}
                        onClick={() => {
                            const craft = new Craft(props.factory.name, props.factory.name, props.factory.inputs, props.factory.outputs, true)
                            props.craftManager.addCraft(craft)
                            const machineCraft = new MachineCraft('machine' + props.factory.name, props.factory.name, true, props.factory.cost, craft)
                            console.log(props.factory.cost)
                            props.craftManager.addMachineCraft(machineCraft)
                        }}>create custom machine from this factory</button>
                    <SelectMachineView machineCrafts={props.craftManager.machineCrafts}
                        onAdd={(mc) => mc.tryConsumeMachineCraft(props.inventory, props.factory)}
                        onRemove={(mc) => props.craftManager.removeMachineCraft(mc.id)}/>
                </div>
                <div className="col-9">
                    <div className="row">
                        {props.factory.factories.map((subFactory, i) => {
                            return <div key={i} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-3 machine-container">
                                <FactoryCardView factory={subFactory}
                                    onClickEnter={() => props.onSelectedFactory(subFactory)}
                                    onDeleteFactory={() => {
                                        props.factory.dismantleSubFactory(subFactory, props.inventory)
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
