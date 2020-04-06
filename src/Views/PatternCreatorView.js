import React from 'react';
import Game from '../Game/Game';
import Pattern from '../Game/Pattern';

class PatternCreatorView extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            pattern: new Pattern()
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

    changeName(newName) {
        var pattern = this.state.pattern;
        pattern.name = newName;
        this.setState({
            pattern: this.state.pattern
        });
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

    renderCost(itemStack) {
        return (
            <div key={itemStack.id}>
                {itemStack.quantity} {itemStack.item.name}
            </div>
        );
    }

    create() {
        this.props.factory.addPattern(this.state.pattern);
        this.setState({
            pattern: new Pattern()
        })
    }

    render() {
        return (
            <div>
                {Game.machineCrafts.map((machineCraft) => this.renderMachinePattern(machineCraft))}
                {this.state.pattern.totalCost.getItemStackList().filter((itemStack) => itemStack.quantity > 0).map((itemStack) => this.renderCost(itemStack))}
                <input value={this.state.pattern.name} onChange={(e) => this.changeName(e.currentTarget.value)} />
                <button className="btn btn-primary" onClick={() => this.create()}>Create pattern</button>
            </div>
        );
    }
}
export default PatternCreatorView;