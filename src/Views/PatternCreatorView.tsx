import React from 'react';
import Game from '../Game/Game';
import Pattern from '../Game/Pattern';
import IBaseProps from './IBaseProps';
import Craft from '../Game/Craft';
import ItemStack from '../Game/ItemStack';

interface IPatternCreatorState {
    pattern: Pattern;
}

class PatternCreatorView extends React.Component<IBaseProps, IPatternCreatorState> {
    constructor(props: IBaseProps) {
        super(props);
        this.state = {
            pattern: new Pattern(this.props.game)
        }
    }

    addMachine(craftId: string) {
        this.state.pattern.addMachine(craftId);
        this.setState({
            pattern: this.state.pattern
        });
    }

    removeMachine(craftId: string) {
        this.state.pattern.removeMachine(craftId);
        this.setState({
            pattern: this.state.pattern
        });
    }

    addPattern(patternId: number) {
        this.state.pattern.addPattern(patternId);
        this.setState({
            pattern: this.state.pattern
        });
    }

    removePattern(patternId: number) {
        this.state.pattern.removePattern(patternId);
        this.setState({
            pattern: this.state.pattern
        });
    }

    changeName(newName: string) {
        var pattern = this.state.pattern;
        pattern.name = newName;
        this.setState({
            pattern: this.state.pattern
        });
    }

    create() {
        this.props.game.addPattern(this.state.pattern);
        this.setState({
            pattern: new Pattern(this.props.game)
        })
    }

    renderMachinePattern(craft: Craft) {
        return (
            <div key={craft.id}>
                <button className="btn btn-primary" onClick={() => this.removeMachine(craft.id)}>-</button>
                <span>{craft.name}</span>
                <button className="btn btn-primary" onClick={() => this.addMachine(craft.id)}>+</button>
                <span>{this.state.pattern.machinesCount[craft.id]}</span>
            </div>
        );
    }

    renderPattern(pattern: Pattern) {
        return (
            <div key={pattern.id}>
                <button className="btn btn-primary" onClick={() => this.removePattern(pattern.id)}>-</button>
                <span>{pattern.name}</span>
                <button className="btn btn-primary" onClick={() => this.addPattern(pattern.id)}>+</button>
                <span>{this.state.pattern.patternsCount[pattern.id]}</span>
            </div>
        );
    }

    renderCost(itemStack: ItemStack) {
        return (
            <div key={itemStack.id}>
                {itemStack.quantity} {itemStack.item.name}
            </div>
        );
    }

    render() {
        return (
            <div>
                {Game.machineCrafts.map((machineCraft) => this.renderMachinePattern(machineCraft))}
                {this.props.game.patterns.map((pattern) => this.renderPattern(pattern))}
                {this.state.pattern.totalCost.getItemStackList().filter((itemStack) => itemStack.quantity > 0).map((itemStack) => this.renderCost(itemStack))}
                <input value={this.state.pattern.name} onChange={(e) => this.changeName(e.currentTarget.value)} />
                <button className="btn btn-primary" onClick={() => this.create()}>Create pattern</button>
            </div>
        );
    }
}
export default PatternCreatorView;
