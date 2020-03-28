import React from 'react';
import '../css/MachineType.css'
import MachineView from './MachineView';
import CraftView from './CraftView';

class MachineTypeView extends React.Component {

    renderMachine(machine) {
        return (
            <MachineView key={machine.id} machine={machine} />
        );
    }

    render() {
        var machinesOfType = this.props.factory.getMachinesOfType(this.props.craft);
        return (
            <div className="machine-type">
                <div className="machine-type-header">
                    <div className="name">{this.props.craft.name}</div>
                    <div className="machine-count">x{machinesOfType.length - 1}</div>
                </div>
                <CraftView craft={this.props.craft.output} inventory={this.props.factory.inventory} />
                {machinesOfType.map((machine) => this.renderMachine(machine))}
                <div className="add-machine">
                    <div className="subtitle">Cost</div>
                    {/*TODO MachineCraftView*/}
                    <button className="btn btn-success btn-machine" key={this.props.craft.id} disabled={!this.props.craft.canCraft(this.props.factory)} onClick={() => this.props.craft.tryCraft(this.props.factory)}><i className="fas fa-hammer fa-2x"></i></button>
                </div>
            </div>
        );
    }
}
export default MachineTypeView;