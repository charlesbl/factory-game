import React from 'react';
import InventoryView from './InventoryView'
import { machineCrafts } from '../Game/Game'
import MachineView from './MachineView';
import '../css/Factory.css'

class FactoryView extends React.Component{
    renderButton(name, craft) {
        return (
            <button className="btn btn-primary" key={name} onClick={() => craft.tryCraft(this.props.factory)}>
                <div>{craft.name}</div>
                {craft.input.map((itemStack) => <div>{itemStack.toString()}</div>)}
            </button>
        );
    }

    renderMachine(machine) {
        return (
            <div  key={machine.id} className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2 machine-container">
                <MachineView machine={machine}/>
            </div>
        )
    }

    render() {
        var buttons = Object.entries(machineCrafts).map(([name, craft]) => this.renderButton(name, craft));
        var machines = this.props.factory.machines.map((machine) => this.renderMachine(machine));
        return (
            <div>
                <InventoryView inventory={this.props.factory.inventory}/>
                {buttons}
                <div className="row">
                    {machines}
                </div>
            </div>
        );
    }
}
export default FactoryView;