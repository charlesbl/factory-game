import React, { ChangeEvent } from 'react';
import '../css/Factory.css'
import Game from '../Game/Game';
import MachineCraft from '../Game/MachineCraft';

interface ISelectMachineProps {
    onChange: (machineCraft?: MachineCraft) => void;
}

export default class SelectMachineView extends React.Component<ISelectMachineProps> {
    renderOption(machineCraft: MachineCraft) {
        return (
            <option key={machineCraft.id} value={machineCraft.id}>{machineCraft.name} {machineCraft.cost.toFixed(2)}€</option>
        );
    }

    changeSelect(event: ChangeEvent<HTMLSelectElement>) {
        if (event.target.value !== "none")
            this.props.onChange(Game.getMachineCraftById(event.target.value));
        else
            this.props.onChange(undefined);
    }

    render() {
        const options = Game.machineCrafts.map((machineCraft) => this.renderOption(machineCraft));
        return (
            <select onChange={(event) => this.changeSelect(event)} className="custom-select custom-select-sm">
                <option value="none">Open this select menu</option>
                {options}
            </select>
        );
    }
}