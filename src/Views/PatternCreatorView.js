import React from 'react';
import Game from '../Game/Game';
import Pattern from '../Game/Pattern';

class PatternCreatorView extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            pattern: new Pattern(this.props.game)
        }
    }

    addMachine(craftId) {
        this.state.pattern.addMachine(craftId);
        this.setState({
            pattern: this.state.pattern
        });
    }

    removeMachine(craftId) {
        this.state.pattern.removeMachine(craftId);
        this.setState({
            pattern: this.state.pattern
        });
    }

    addPattern(patternId) {
        this.state.pattern.addPattern(patternId);
        this.setState({
            pattern: this.state.pattern
        });
    }

    removePattern(patternId) {
        this.state.pattern.removePattern(patternId);
        this.setState({
            pattern: this.state.pattern
        });
    }

    changeName(newName) {
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

    renderMachinePattern(craft) {
        return (
            <div key={craft.id}>
                <button className="btn btn-primary" onClick={() => this.removeMachine(craft.id)}>-</button>
                <span>{craft.name}</span>
                <button className="btn btn-primary" onClick={() => this.addMachine(craft.id)}>+</button>
                <span>{this.state.pattern.machines[craft.id]}</span>
            </div>
        );
    }

    renderPattern(pattern) {
        return (
            <div key={pattern.id}>
                <button className="btn btn-primary" onClick={() => this.removePattern(pattern.id)}>-</button>
                <span>{pattern.name}</span>
                <button className="btn btn-primary" onClick={() => this.addPattern(pattern.id)}>+</button>
                <span>{this.state.pattern.patterns[pattern.id]}</span>        {pattern.id}
            </div>
        );
    }

    renderCost(itemStack) {
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
