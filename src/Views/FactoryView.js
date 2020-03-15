import React from 'react';
import InventoryView from './InventoryView'
import { machineCrafts } from '../Game/Game'
import MachineView from './MachineView';

class FactoryView extends React.Component{
    renderButton(name, craft) {
        return (
            <button key={name} onClick={() => craft.tryCraft(this.props.factory)}>
                <div>Build {craft.name}</div>
                {craft.input.map((itemStack) => itemStack.toString())}
            </button>
        );
    }

    renderMachine(machine) {
        return (
            <MachineView key={machine.id} machine={machine}/>
        )
    }

    render() {
        var buttons = Object.entries(machineCrafts).map(([name, craft]) => this.renderButton(name, craft));
        var machines = this.props.factory.machines.map((machine) => this.renderMachine(machine))
        return (
            <div>
                {buttons}
                <InventoryView inventory={this.props.factory.inventory}/>
                {machines}
            </div>
        );
    }
}
export default FactoryView;