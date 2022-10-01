import React, { useState } from 'react'
import '../css/Factory.css'
import Inventory from '../Game/Inventory'
import MachineCraft from '../Game/MachineCraft'
import Ressources from '../Game/Resources/Ressources'

interface ISelectMachineProps {
    onAddClicked: (machineCraft: MachineCraft) => void
    inventory: Inventory
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
        onChange()
    }
}

const SelectMachineView = (props: ISelectMachineProps): JSX.Element => {
    const [selectedMachineCraft, selectMachineCraft] = useState<MachineCraft | undefined>(undefined)

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    const canCraft = selectedMachineCraft != null && selectedMachineCraft.canCraft(props.inventory)

    const options = Ressources.getMachineCrafts().map((machineCraft) => renderOption(machineCraft))
    return (
        <div>
            <select onChange={(event) => changeSelect(event.target.value, (mc) => selectMachineCraft(mc))} className="custom-select custom-select-sm">
                <option value="none">Open this select menu</option>
                {options}
            </select>

            <button className="btn btn-primary"
                disabled={!canCraft}
                onClick={() => {
                    if (selectedMachineCraft == null || !canCraft) return
                    props.onAddClicked(selectedMachineCraft)
                }}>
            Add machine
            </button>
        </div>
    )
}

export default SelectMachineView
