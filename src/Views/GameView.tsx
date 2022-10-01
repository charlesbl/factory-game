import React, { useState } from 'react'
import FactoryView from './FactoryView'
import IBaseProps from './IBaseProps'
import Factory from '../Game/Factory'
import InventoryView from './InventoryView'
import SelectMachineView from './SelectMachineView'
import Machine from '../Game/Machine'
import ManualMachineView from './ManualMachineView'
import Inventory from '../Game/Inventory'
import Craft from '../Game/Craft'
import Ingredient from '../Game/Ingredient'
import Ressources from '../Game/Resources/Ressources'
import MachineCraft from '../Game/MachineCraft'

const renderManualMachine = (machine: Machine, index: number, inventory: Inventory): JSX.Element => {
    return (
        <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
            <ManualMachineView machine={machine} inventory={inventory}/>
        </div>
    )
}

const GameView = (props: IBaseProps): JSX.Element => {
    const [factories, setFactories] = useState<Factory[]>([props.game.factory])
    const currentFactory = factories[factories.length - 1]

    const manualMachines = props.game.manualMachines.map((machine, i) => renderManualMachine(machine, i, props.game.inventory))

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
            <button className="btn btn-primary" onClick={() => {
                const randName = (Math.random() * 1000).toFixed()
                const randQuantity = Math.random() * 10
                const craft = new Craft(randName, randName, [new Ingredient(Ressources.getItems()[0], randQuantity)], [new Ingredient(Ressources.getItems()[1], randQuantity)])
                props.game.craftManager.addCraft(craft)
                const machineCraft = new MachineCraft('machine' + randName, randName, [], craft)
                props.game.craftManager.addMachineCraft(machineCraft)
            }}>
                    add random craft
            </button>

            <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2">
                <SelectMachineView inventory={props.game.inventory} craftManager={props.game.craftManager} onAddClicked={(mc) => {
                    props.game.tryConsumeMachineCraft(mc, currentFactory)
                }}/>
                <button className="btn btn-primary" onClick={() => currentFactory.addSubFactory()}>
                        Add factory
                </button>
            </div>

            <FactoryView
                factory={currentFactory}
                onSelectedFactory={(factory) => {
                    setFactories([...factories, factory])
                }}/>
        </div>
    )
}

export default GameView
