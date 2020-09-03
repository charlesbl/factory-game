import React from 'react';
import InventoryView from './InventoryView'
import '../css/Factory.css'
import Factory from '../Game/Factory';
import Machine from '../Game/Machine';
import MachineView from './MachineView';
import FactoryCardView from './FactoryCardView';
import IBaseProps from './IBaseProps';
import SelectMachineView from './SelectMachineView';
import MachineCraft from '../Game/MachineCraft';
import SelectFactoryView from './SelectFactoryView';

interface IFactoryProps extends IBaseProps {
    factory: Factory;
    onSelectedFactory: (factory: Factory) => void;
    onGoBack: () => void;
}
interface IFactoryState {
    selectedMachineCraft: MachineCraft | undefined;
}

export default class FactoryView extends React.Component<IFactoryProps, IFactoryState> {
    selectMachineCraft(machineCraft: MachineCraft | undefined) {
        this.setState({
            selectedMachineCraft: machineCraft
        });
    }

    renderMachine(machine: Machine) {
        return (
            <div key={machine.id} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
                <MachineView machine={machine} />
            </div>
        );
    }
    renderFactoryCard(factory: Factory) {
        return (
            <div key={factory.id} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
                <FactoryCardView factory={factory} onClickEnter={() => this.props.onSelectedFactory(factory)} />
            </div>
        );
    }

    render() {
        var machines = this.props.factory.machines.map((machine) => this.renderMachine(machine));
        var factories = this.props.factory.factories.map((factory) => this.renderFactoryCard(factory));
        var returnButton = this.props.factory.topFactory ? <button className="btn btn-primary" onClick={() => this.props.onGoBack()}>Return</button> : "";
        return (
            <div>
                <InventoryView game={this.props.game} inventory={this.props.game.factory.inventory} />
                {returnButton}
                {this.props.factory.topFactory ? <InventoryView game={this.props.game} inventory={this.props.factory.inventory} /> : ""}
                <div className="row">
                    {machines}
                </div>
                <div className="row">
                    {factories}
                </div>
                <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2 machine-container">
                    <SelectFactoryView game={this.props.game} onChange={(pattern) => this.props.factory.buildSubFactory(pattern)} />
                    <button className="btn btn-primary" onClick={() => this.props.factory.buildSubFactory()}>Add factory</button>
                    <SelectMachineView onChange={(machineCraft) => this.selectMachineCraft(machineCraft)} />
                    <button className="btn btn-primary"
                        disabled={!(this.state && this.state.selectedMachineCraft && this.state.selectedMachineCraft.canCraft(this.props.game.factory))}
                        onClick={() => this.state.selectedMachineCraft?.tryCraft(this.props.game.factory, this.props.factory)}>Add machine</button>
                </div>
            </div>
        );
    }
}