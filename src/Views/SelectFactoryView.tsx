import React, { ChangeEvent } from 'react';
import '../css/Factory.css'
import Pattern from '../Game/Pattern';
import IBaseProps from './IBaseProps';

interface ISelectFactoryProps extends IBaseProps {
    onChange: (pattern?: Pattern) => void;
}

export default class SelectFactoryView extends React.Component<ISelectFactoryProps> {
    renderOption(pattern: Pattern) {
        return (
            <option key={pattern.id} value={pattern.id}>{pattern.name} {Math.trunc(pattern.costPrice)}€</option>
        );
    }

    changeSelect(event: ChangeEvent<HTMLSelectElement>) {
        if (event.target.value !== "none")
            this.props.onChange(this.props.game.getPatternById(Number.parseInt(event.target.value)));
        else
            this.props.onChange(undefined);
    }

    render() {
        var options = this.props.game.patterns.map((pattern) => this.renderOption(pattern));
        return (
            <select onChange={(event) => this.changeSelect(event)} className="custom-select custom-select-sm">
                <option value="none">Open this select menu</option>
                {options}
            </select>
        );
    }
}