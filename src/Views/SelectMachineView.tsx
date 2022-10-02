import React, { } from 'react'
import '../css/SelectMachine.css'
import MachineCraft from '../Game/MachineCraft'
import MachineCraftView from './MachineCraftView'

interface ISelectMachineProps {
    machineCrafts: MachineCraft[]
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
                    onAdd={() => props.onAdd(machineCraft)}
                    onRemove={() => props.onRemove(machineCraft)} />)}
            </div>
        </div>
    )
}

export default SelectMachineView
