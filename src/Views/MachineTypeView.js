import React from 'react';
import '../css/MachineType.css'
import MachineView from './MachineView';

class MachineTypeView extends React.Component {

    renderAvailableResources(itemStack) {
        var count = this.props.factory.inventory.count(itemStack.item);
        var capedCount = count > itemStack.quantity ? itemStack.quantity : count;
        return (
            <div key={itemStack.id} className="row no-gutters">
                <div className="col-4 text-right">{capedCount}/{itemStack.quantity}</div>
                <div className="col-8 text-left">
                    <span className="available-resources-name">{itemStack.item.name}</span>
                </div>
            </div>
        );
    }

    renderMachine(machine) {
        return (
            <MachineView key={machine.id} machine={machine} />
        );
    }

    render() {
        var availableResources = this.props.craft.output.input.length > 0 ?
            <div className="available-resources">
                <div className="subtitle">Needed resources</div>
                {this.props.craft.output.input.map((itemStack => this.renderAvailableResources(itemStack)))}
            </div> : "";
        return (
            <div className="machineType">
                <div className="name">{this.props.craft.name}</div>
                {availableResources}
                {this.props.factory.getMachinesOfType(this.props.craft).map((machine) => this.renderMachine(machine))}
                <div className="add-machine">
                    <div className="subtitle">Cost</div>
                    {this.props.craft.input.map((itemStack => this.renderAvailableResources(itemStack)))}
                    <button className="btn btn-success btn-machine" key={this.props.craft.id} onClick={() => this.props.craft.tryCraft(this.props.factory)}><i class="fas fa-hammer fa-2x"></i></button>
                </div>
            </div>
        );
    }
}
export default MachineTypeView;