import React from 'react'
import '../css/Factory.css'
import Factory from '../Game/Factory'
import MachineView from './MachineView'
import FactoryCardView from './FactoryCardView'
import Craft from '../Game/Craft'
import CraftManager from '../Game/CraftManager'
import MachineCraft from '../Game/MachineCraft'
import Inventory from '../Game/Inventory'

interface IFactoryProps {
    factory: Factory
    onSelectedFactory: (factory: Factory) => void
    craftManager: CraftManager
    inventory: Inventory
}

const FactoryView = (props: IFactoryProps): JSX.Element => {
    return (
        <div>
            <button className="btn btn-primary" onClick={() => props.factory.updateInputsAndOutputs()}>Refresh</button>
            <button className="btn btn-primary" onClick={() => {
                const craft = new Craft(props.factory.name, props.factory.name, props.factory.inputs, props.factory.outputs, true)
                props.craftManager.addCraft(craft)
                const machineCraft = new MachineCraft('machine' + props.factory.name, props.factory.name, true, props.factory.cost, craft)
                console.log(props.factory.cost)
                props.craftManager.addMachineCraft(machineCraft)
            }}>create custom machine from this factory</button>
            <div className="row">
                {props.factory.factories.map((factory, i) => {
                    return <div key={i} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
                        <FactoryCardView factory={factory}
                            onClickEnter={() => props.onSelectedFactory(factory)}
                            onDeleteFactory={() => {
                                factory.cost.forEach((ingredient) => props.inventory.addItem(ingredient.item, ingredient.quantityPerSecond))
                                props.factory.destroySubFactory(factory)
                            }} />
                    </div>
                })}
                {props.factory.machines.map((machine, i) => {
                    return <div key={i} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
                        <MachineView machine={machine}
                            onDeleteMachine={() => {
                                machine.machineCraft.input.forEach((ingredient) => props.inventory.addItem(ingredient.item, ingredient.quantityPerSecond))
                                props.factory.destroyMachine(machine)
                            }}
                            onTogglePauseMachine={() => props.factory.togglePauseMachine(machine)}/>
                    </div>
                })}
            </div>
        </div>
    )
}

export default FactoryView
