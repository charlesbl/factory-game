import React, { ChangeEvent } from 'react'
import '../css/Factory.css'
import MachineCraft from '../Game/MachineCraft'
import Ressources from '../Game/Resources/Ressources'

interface ISelectMachineProps {
    onChange: (machineCraft?: MachineCraft) => void
}

export default class SelectMachineView extends React.Component<ISelectMachineProps> {
    renderOption (machineCraft: MachineCraft): JSX.Element {
        return (
            <option key={machineCraft.id} value={machineCraft.id}>{machineCraft.name} 0€</option>
        )
    }

    changeSelect (event: ChangeEvent<HTMLSelectElement>): void {
        if (event.target.value !== 'none') {
            this.props.onChange(Ressources.getMachineCraftById(event.target.value))
        } else {
            this.props.onChange(undefined)
        }
    }

    render (): JSX.Element {
        const options = Ressources.MachineCrafts.map((machineCraft) => this.renderOption(machineCraft))
        return (
            <select onChange={(event) => this.changeSelect(event)} className="custom-select custom-select-sm">
                <option value="none">Open this select menu</option>
                {options}
            </select>
        )
    }
}
