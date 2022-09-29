import React from 'react';
import '../css/Factory.css'
import Factory from '../Game/Factory';
import Machine from '../Game/Machine';
import MachineView from './MachineView';
import FactoryCardView from './FactoryCardView';
import IBaseProps from './IBaseProps';
import SelectMachineView from './SelectMachineView';
import MachineCraft from '../Game/MachineCraft';

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

    renderMachine(machine: Machine, index: number) {
        return (
            <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
                <MachineView machine={machine} />
            </div>
        );
    }

    renderFactoryCard(factory: Factory, index: number) {
        return (
            <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
                <FactoryCardView factory={factory} onClickEnter={() => this.props.onSelectedFactory(factory)} />
            </div>
        );
    }

    render() {
        const machines = this.props.factory.machines.map((machine, i) => this.renderMachine(machine, i));
        const factories = this.props.factory.factories.map((factory, i) => this.renderFactoryCard(factory, i));
        const returnButton = <button className="btn btn-primary" onClick={() => this.props.onGoBack()}>Return</button>
        return (
            <div>
                {/* <InventoryView game={this.props.game} inventory={this.props.game.factory.inventory} /> */}
                {returnButton}
                <div className="row">
                    {machines}
                </div>
                <div className="row">
                    {factories}
                </div>
                <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2 machine-container">
                    <button className="btn btn-primary"
                        onClick={() => this.props.factory.addSubFactory()}>Add factory</button>
                    <SelectMachineView onChange={(machineCraft) => this.selectMachineCraft(machineCraft)} />
                    <button className="btn btn-primary"
                        onClick={() => console.error("Add machine not implemented")}>Add machine</button>
                </div>
            </div>
        );
    }
}