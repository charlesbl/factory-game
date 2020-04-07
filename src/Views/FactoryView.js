import React from 'react';
import InventoryView from './InventoryView'
import MachineTypeView from './MachineTypeView';
import '../css/Factory.css'
import Game from '../Game/Game';
import PatternCreatorView from './PatternCreatorView';
import PatternView from './PatternView';

class FactoryView extends React.Component {
    renderMachine(craft) {
        return (
            <div key={craft.id} className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2 machine-container">
                <MachineTypeView craft={craft} factory={this.props.game.factory} />
            </div>
        );
    }

    renderPattern(pattern) {
        return (
            <PatternView key={pattern.id} pattern={pattern} factory={this.props.game.factory} />
        );
    }

    render() {
        var machines = Game.machineCrafts.map((craft) => this.renderMachine(craft));
        var patterns = this.props.game.patterns.map((pattern) => this.renderPattern(pattern));
        return (
            <div>
                <PatternCreatorView game={this.props.game} />
                <InventoryView inventory={this.props.game.factory.inventory} />
                <div className="row">
                    {machines}
                    {patterns}
                </div>
            </div>
        );
    }
}
export default FactoryView;