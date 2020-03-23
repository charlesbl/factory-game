import React from 'react';
import '../css/Machine.css'

class MachineView extends React.Component {

    renderAvailableResources(itemStack) {
        var count = this.props.machine.factory.inventory.count(itemStack.item);
        var maxedCount = count > itemStack.quantity ? itemStack.quantity : count;
        return (
            <div key={itemStack.id} className="row no-gutters">
                <div className="col-4 text-right">{maxedCount}/{itemStack.quantity}</div>
                <div className="col-8 text-left">
                    <span className="available-resources-name">{itemStack.item.name}</span>
                </div>
            </div>
        );
    }

    render() {
        var availableResources;
        if (this.props.machine.craft.input.length > 0) {
            availableResources = (
                <div className="available-resources">
                    <div className="subtitle">Available resources</div>
                    {this.props.machine.craft.input.map((itemStack => this.renderAvailableResources(itemStack)))}
                </div>
            );
        }
        return (
            <div className="machine">
                <progress className="progress" max={100} value={this.props.machine.getPercentage()}></progress>
                <button onClick={() => this.props.machine.destroy()} className="btn-danger btn-delete">X</button>
                <button onClick={() => this.props.machine.togglePause()} className="btn-warning btn-pause">{this.props.machine.pause ? "start" : "pause"}</button>
                <div className="name">{this.props.machine.name}</div>
                <div>Optimisation: 83% (1 min)</div>

                {availableResources}
                <div className="rate">
                    <div className="subtitle">Input rate</div>
                    <div className="row no-gutters">
                        <div className="col-7 text-right">
                            <span className="rate-name">Iron Plate:</span>
                        </div>
                        <div className="col-5 text-left">10.5/s</div>
                    </div>
                    <div className="row no-gutters">
                        <div className="col-7 text-right">
                            <span className="rate-name">Iron Ingot:</span>
                        </div>
                        <div className="col-5 text-left">9/s</div>
                    </div>
                </div>

                <div className="rate">
                    <div className="subtitle">Output rate</div>
                    <div className="row no-gutters">
                        <div className="col-7 text-right">
                            <span className="rate-name">Iron Plate:</span>
                        </div>
                        <div className="col-5 text-left">10.5/s</div>
                    </div>
                    <div className="row no-gutters">
                        <div className="col-7 text-right">
                            <span className="rate-name">Iron Ingot:</span>
                        </div>
                        <div className="col-5 text-left">9/s</div>
                    </div>
                </div>
            </div>
        );
    }
}
export default MachineView;