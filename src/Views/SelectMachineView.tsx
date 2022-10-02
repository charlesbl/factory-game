import React, { useState } from 'react'
import '../css/Factory.css'
import CraftManager from '../Game/CraftManager'
import Inventory from '../Game/Inventory'
import MachineCraft from '../Game/MachineCraft'

interface ISelectMachineProps {
    onAddClicked: (machineCraft: MachineCraft) => void
    inventory: Inventory
    craftManager: CraftManager
}

const changeSelect = (value: string, onChange: (machineCraft?: MachineCraft) => void, craftManager: CraftManager): void => {
    if (value !== 'none') {
        onChange(craftManager.getMachineCraftById(value))
    } else {
        onChange()
    }
}

const SelectMachineView = (props: ISelectMachineProps): JSX.Element => {
    const [selectedMachineCraft, selectMachineCraft] = useState<MachineCraft | undefined>(undefined)

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    const canCraft = selectedMachineCraft != null && selectedMachineCraft.canCraft(props.inventory)

    return (
        <div>
            <select onChange={(event) => changeSelect(event.target.value, (mc) => selectMachineCraft(mc), props.craftManager)} className="custom-select custom-select-sm">
                <option value="none">Open this select menu</option>
                {props.craftManager.machineCrafts.map((machineCraft) => {
                    return <option key={machineCraft.id} value={machineCraft.id}>{machineCraft.name}: {machineCraft.input.map((i) => `${i.quantityPerSecond} ${i.item.name}`).join(' - ')}</option>
                })}
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
