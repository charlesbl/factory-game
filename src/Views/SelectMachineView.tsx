import React, { } from 'react'
import '../css/SelectMachine.css'
import Inventory from '../Game/Inventory'
import MachineCraft from '../Game/MachineCraft'
import MachineCraftView from './MachineCraftView'

interface ISelectMachineProps {
    machineCrafts: MachineCraft[]
    inventory: Inventory
    onAdd: (machineCraft: MachineCraft) => void
    onRemove: (machineCraft: MachineCraft) => void
}

const SelectMachineView = (props: ISelectMachineProps): JSX.Element => {
    return (
        <div className='select-machine'>
            <h2>Build machines</h2>
            <div>
                {props.machineCrafts.map((machineCraft) => <MachineCraftView
                    key={machineCraft.id}
                    machineCraft={machineCraft}
                    afordable={machineCraft.canCraft(props.inventory)}
                    onAdd={() => props.onAdd(machineCraft)}
                    onRemove={() => props.onRemove(machineCraft)} />)}
            </div>
        </div>
    )
}

export default SelectMachineView
