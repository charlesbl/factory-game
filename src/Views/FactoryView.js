import React from 'react';
import InventoryView from './InventoryView'
import MachineTypeView from './MachineTypeView';
import '../css/Factory.css'
import Game from '../Game/Game';

class FactoryView extends React.Component {
    renderButton(craft) {
        return (
            <button className="btn btn-primary" key={craft.id} onClick={() => craft.tryCraft(this.props.factory)}>
                <div>{craft.name}</div>
                {craft.input.map((itemStack) => <div key={itemStack.id}>{itemStack.toString()}</div>)}
            </button>
        );
    }

    renderMachine(craft) {
        return (
            <div key={craft.id} className="col-6 col-sm-4 col-md-3 col-lg-2 col-xl-2 machine-container">
                <MachineTypeView craft={craft} factory={this.props.factory} />
            </div>
        );
    }

    render() {
        var machines = Game.machineCrafts.map((craft) => this.renderMachine(craft));
        return (
            <div>
                <InventoryView inventory={this.props.factory.inventory} />
                <div className="row">
                    {machines}
                </div>
            </div>
        );
    }
}
export default FactoryView;