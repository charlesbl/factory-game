import React from 'react';
import InventoryView from './InventoryView'
import '../css/Factory.css'
import Factory from '../Game/Factory';
import Machine from '../Game/Machine';
import MachineView from './MachineView';
import FactoryCardView from './FactoryCardView';
import Game from '../Game/Game';

interface IFactoryProps {
    factory: Factory;
    onSelectedFactory: (factory: Factory) => void;
    onGoBack: () => void;
}

export default class FactoryView extends React.Component<IFactoryProps> {
    renderMachine(machine: Machine) {
        return (
            <div key={machine.id} className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2 machine-container">
                <MachineView machine={machine} />
            </div>
        );
    }
    renderFactoryCard(factory: Factory) {
        return (
            <div key={factory.id} className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2 machine-container">
                <FactoryCardView factory={factory} onClickEnter={() => this.props.onSelectedFactory(factory)} />
            </div>
        );
    }

    render() {
        var machines = this.props.factory.machines.map((machine) => this.renderMachine(machine));
        var factories = this.props.factory.factories.map((factory) => this.renderFactoryCard(factory));
        var returnButton = this.props.factory.topFactory ? <button className="btn btn-primary" onClick={() => this.props.onGoBack()}>Return</button> : ""
        return (
            <div>
                {returnButton}
                <InventoryView inventory={this.props.factory.inventory} />
                <div className="row">
                    {machines}
                    {factories}
                    <div className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2 machine-container">
                        <button className="btn btn-primary" onClick={() => this.props.factory.buildSubFactory()}>Add factory</button>
                        <button className="btn btn-primary" onClick={() => this.props.factory.buildMachine(Game.getMachineCraftById("ironOreDrill"))}>Add machine</button>
                    </div>
                </div>
            </div>
        );
    }
}