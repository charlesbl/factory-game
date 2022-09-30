import React from 'react'
import '../css/Factory.css'
import MachineCraft from '../Game/MachineCraft'
import Ressources from '../Game/Resources/Ressources'

interface ISelectMachineProps {
    onChange: (machineCraft?: MachineCraft) => void
}

const renderOption = (machineCraft: MachineCraft): JSX.Element => {
    return (
        <option key={machineCraft.id} value={machineCraft.id}>{machineCraft.name} 0€</option>
    )
}

const changeSelect = (value: string, onChange: (machineCraft?: MachineCraft) => void): void => {
    if (value !== 'none') {
        onChange(Ressources.getMachineCraftById(value))
    } else {
        onChange(undefined)
    }
}

const SelectMachineView = (props: ISelectMachineProps): JSX.Element => {
    const options = Ressources.getMachineCrafts().map((machineCraft) => renderOption(machineCraft))
    return (
        <select onChange={(event) => changeSelect(event.target.value, props.onChange)} className="custom-select custom-select-sm">
            <option value="none">Open this select menu</option>
            {options}
        </select>
    )
}

export default SelectMachineView
