import React from 'react';
import '../css/Machine.css'
import Machine from '../Game/Machine';

interface IMachineProps {
    machine: Machine
}

class MachineView extends React.Component<IMachineProps> {
    render() {
        var canCraft = this.props.machine.canCraft() || this.props.machine.isCrafting;
        var craftBtn = this.props.machine.manual ?
            <button onMouseDown={() => this.props.machine.pause = false}
                onMouseUp={() => this.props.machine.pause = true}
                onMouseOut={() => this.props.machine.pause = true}
                className="btn btn-warning btn-side" disabled={!canCraft}>
                <i className="fas fa-hammer fa-xs"></i>
            </button> : "";

        var pauseBtn = !this.props.machine.manual ? <button onClick={() => this.props.machine.togglePause()} className="btn btn-warning btn-side">{this.props.machine.pause ? <i className="fas fa-play fa-xs"></i> : <i className="fas fa-pause fa-xs"></i>}</button> : "";
        var destroyBtn = !this.props.machine.manual ? <button onClick={() => this.props.machine.destroy()} className="btn btn-danger btn-side"><i className="fas fa-trash fa-xs"></i></button> : "";
        return (
            <div className="machine">
                <progress className="progress" max={100} value={this.props.machine.getPercentage()}></progress>
                {craftBtn}
                {pauseBtn}
                {destroyBtn}
            </div>
        );
    }
}
export default MachineView;