import React, { ChangeEvent } from 'react';
import '../css/Factory.css'
import Game from '../Game/Game';
import MachineCraft from '../Game/MachineCraft';

interface ISelectMachineProps {
    onChange: (machineCraft: MachineCraft | undefined) => void;
}

export default class SelectMachineView extends React.Component<ISelectMachineProps> {
    renderOption(machineCraft: MachineCraft) {
        return (
            <option key={machineCraft.id} value={machineCraft.id}>{machineCraft.name}</option>
        );
    }

    changeSelect(event: ChangeEvent<HTMLSelectElement>) {
        this.props.onChange(Game.getMachineCraftById(event.target.value));
    }

    render() {
        var options = Game.machineCrafts.map((machineCraft) => this.renderOption(machineCraft));
        return (
            <select onChange={(event) => this.changeSelect(event)} className="custom-select custom-select-sm">
                <option>Open this select menu</option>
                {options}
            </select>
        );
    }
}