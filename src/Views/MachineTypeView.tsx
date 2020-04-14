import React from 'react';
import '../css/MachineType.css'
import MachineView from './MachineView';
import CraftView from './CraftView';
import ItemStack from '../Game/ItemStack';
import Factory from '../Game/Factory';
import Machine from '../Game/Machine';
import MachineCraft from '../Game/MachineCraft';

interface IMachineTypeProps {
    factory: Factory;
    craft: MachineCraft;
}

export default class MachineTypeView extends React.Component<IMachineTypeProps> {

    renderMachineCost(itemStack: ItemStack) {
        var count = this.props.factory.inventory.getQuantity(itemStack.item);
        var capedCount = count > itemStack.quantity ? itemStack.quantity : count;
        return (
            <div key={itemStack.id}>
                {capedCount}/{itemStack.quantity} {itemStack.item.name}
            </div>
        );
    }

    renderMachine(machine: Machine) {
        return (
            <MachineView key={machine.id} machine={machine} />
        );
    }

    render() {
        var machinesOfType = this.props.factory.getMachinesOfType(this.props.craft.outputCraft);
        return (
            <div className="machine-type">
                <div className="machine-type-header">
                    <div className="name">{this.props.craft.name}</div>
                    <div className="machine-count">x{machinesOfType.length - 1}</div>
                </div>
                <CraftView craft={this.props.craft.outputCraft} inventory={this.props.factory.inventory} />
                {machinesOfType.map((machine) => this.renderMachine(machine))}
                <div className="add-machine">
                    <div className="subtitle">Cost</div>
                    {this.props.craft.input.map((itemStack) => this.renderMachineCost(itemStack))}
                    <button className="btn btn-success btn-machine" key={this.props.craft.id} disabled={!this.props.craft.canCraft(this.props.factory)} onClick={() => this.props.craft.tryCraft(this.props.factory)}><i className="fas fa-hammer fa-2x"></i></button>
                </div>
            </div>
        );
    }
}